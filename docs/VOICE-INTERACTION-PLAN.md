# Voice Interaction Layer for Dispatch

> **Goal:** Create a sticky "wow moment" through voice-native agent orchestration — talk to your agents, hear them respond.

## Vision

Transform Dispatch from a visual-only interface to a voice-native coding companion:

1. **Talk to agents** — "Claude, refactor the auth module" → agent starts working
2. **Agents talk back** — Progress updates, questions, and summaries spoken aloud
3. **Hands-free sessions** — Voice commands while reading code, no context switching
4. **Multi-agent conversations** — Each agent has a distinct voice persona

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                         SpeechBus                                │
│  Central abstraction for all voice I/O                          │
├───────────────────────────┬─────────────────────────────────────┤
│       STT Channel         │           TTS Channel               │
│  ┌─────────────────────┐  │  ┌───────────────────────────────┐  │
│  │  VAD (Silero)       │  │  │  Voice Registry               │  │
│  │  ↓                  │  │  │  (voice ID → model + config)  │  │
│  │  Segmentation       │  │  │  ↓                            │  │
│  │  ↓                  │  │  │  TTS Engine                   │  │
│  │  STT Engine         │  │  │  (Fish S2 / Chatterbox)       │  │
│  │  (Whisper/Parakeet) │  │  │  ↓                            │  │
│  │  ↓                  │  │  │  Audio Streaming              │  │
│  │  Transcript Events  │  │  │  (WebAudio / Electron)        │  │
│  └─────────────────────┘  │  └───────────────────────────────┘  │
└───────────────────────────┴─────────────────────────────────────┘
             ↓                              ↑
      onTranscript()                  speak(text, voice, style)
             ↓                              ↑
┌─────────────────────────────────────────────────────────────────┐
│                    Voice Command Router                          │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  Intent Parser                                           │    │
│  │  - "Claude, do X" → route to Claude Code adapter        │    │
│  │  - "Stop" / "Cancel" → interrupt current agent          │    │
│  │  - "Switch to [agent]" → change active agent            │    │
│  └─────────────────────────────────────────────────────────┘    │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  Response Handler                                        │    │
│  │  - Agent turn complete → summarize → TTS queue          │    │
│  │  - Agent question → TTS with higher priority            │    │
│  │  - Long output → smart truncation + "see details"       │    │
│  └─────────────────────────────────────────────────────────┘    │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  Interrupt Controller                                    │    │
│  │  - User starts speaking → pause TTS                     │    │
│  │  - "Stop" command → cancel TTS + optionally agent       │    │
│  └─────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
             ↓                              ↑
┌─────────────────────────────────────────────────────────────────┐
│                    Dispatch Core (existing)                      │
│  - Session Manager                                               │
│  - Adapters (Claude Code, OpenClaw)                             │
│  - Task Store                                                    │
└─────────────────────────────────────────────────────────────────┘
```

---

## Technology Choices

### STT (Speech-to-Text)

| Model | Params | Latency | Accuracy | Use Case |
|-------|--------|---------|----------|----------|
| **Distil-Whisper** | ~750M | Fast (5-6x V3) | Near V3 | Default for English |
| Whisper V3 Turbo | ~1.5B | Medium | Excellent | Multilingual fallback |
| Parakeet TDT | ~600M | Ultra-low (<100ms) | Good | Real-time streaming |
| Moonshine | ~27M | Very fast | Acceptable | Edge/low-resource |

**Recommendation:** Start with **Distil-Whisper** for quality/speed balance. Add Parakeet for ultra-low-latency mode.

### TTS (Text-to-Speech)

| Model | Params | Latency | Quality | Use Case |
|-------|--------|---------|---------|----------|
| **Fish Speech S2** | ~500M | <150ms | ElevenLabs-tier | Primary engine |
| Chatterbox | ~300M | ~200ms | Excellent | Voice cloning |
| Kokoro | 82M | <100ms | Good | CPU fallback |
| StyleTTS 2 | ~200M | ~300ms | Excellent | Fine-tuned voices |

**Recommendation:** Start with **Fish S2** for quality + emotion control. Add **Kokoro** as CPU-only fallback.

### VAD (Voice Activity Detection)

| Model | Size | Latency | Notes |
|-------|------|---------|-------|
| **Silero VAD** | 2MB | <10ms | Industry standard, well-tested |
| WebRTC VAD | Built-in | <5ms | Simpler but less accurate |

**Recommendation:** **Silero VAD** — tiny, fast, reliable.

---

## Package Structure

```
packages/speech/
├── src/
│   ├── index.ts                 # Public API exports
│   ├── types.ts                 # Shared types
│   │
│   ├── bus/
│   │   ├── speech-bus.ts        # Central SpeechBus orchestrator
│   │   ├── stt-channel.ts       # STT channel abstraction
│   │   └── tts-channel.ts       # TTS channel abstraction
│   │
│   ├── stt/
│   │   ├── types.ts             # STT backend interface
│   │   ├── whisper.ts           # Whisper/Distil-Whisper backend
│   │   ├── parakeet.ts          # Parakeet TDT backend (optional)
│   │   └── vad/
│   │       ├── silero.ts        # Silero VAD wrapper
│   │       └── segmenter.ts     # Turn segmentation logic
│   │
│   ├── tts/
│   │   ├── types.ts             # TTS backend interface
│   │   ├── fish-s2.ts           # Fish Speech S2 backend
│   │   ├── kokoro.ts            # Kokoro CPU fallback
│   │   ├── voice-registry.ts    # Voice ID → config mapping
│   │   └── audio-player.ts      # WebAudio/Electron playback
│   │
│   ├── router/
│   │   ├── command-router.ts    # Voice command → action routing
│   │   ├── intent-parser.ts     # NLU for voice commands
│   │   └── response-handler.ts  # Agent output → TTS
│   │
│   └── electron/
│       ├── microphone.ts        # Electron mic access
│       └── audio-output.ts      # Electron audio output
│
├── package.json
├── tsconfig.json
└── README.md
```

---

## API Design

### SpeechBus (Main Entry Point)

```typescript
interface SpeechBus {
  // Lifecycle
  start(): Promise<void>;
  stop(): Promise<void>;
  
  // STT
  startListening(): void;
  stopListening(): void;
  onTranscript(callback: (event: TranscriptEvent) => void): void;
  
  // TTS
  speak(text: string, options?: SpeakOptions): Promise<void>;
  stopSpeaking(): void;
  isSpeaking(): boolean;
  
  // Configuration
  setSTTBackend(backend: 'whisper' | 'parakeet'): void;
  setTTSBackend(backend: 'fish-s2' | 'kokoro'): void;
  setVoice(voiceId: string): void;
}

interface TranscriptEvent {
  text: string;
  isFinal: boolean;
  segmentId: string;
  confidence: number;
  timestamp: number;
}

interface SpeakOptions {
  voice?: string;           // Voice ID from registry
  style?: string;           // Emotion/style tag (Fish S2)
  priority?: 'low' | 'normal' | 'high';
  interruptible?: boolean;  // Can be interrupted by user speech
}
```

### Voice Registry

```typescript
interface VoiceConfig {
  id: string;
  name: string;
  backend: 'fish-s2' | 'kokoro' | 'chatterbox';
  // Fish S2 specific
  fishVoiceId?: string;
  defaultStyle?: string;
  // Chatterbox specific
  referenceAudio?: string;  // Path to 5-10s reference clip
  // Kokoro specific
  kokoroVoice?: string;
}

// Built-in voices
const AGENT_VOICES: Record<string, VoiceConfig> = {
  'claude': {
    id: 'claude',
    name: 'Claude',
    backend: 'fish-s2',
    fishVoiceId: 'aria',  // Calm, thoughtful
    defaultStyle: '[thoughtful]',
  },
  'system': {
    id: 'system',
    name: 'System',
    backend: 'kokoro',
    kokoroVoice: 'af_bella',  // Fast, neutral
  },
};
```

### Command Router

```typescript
interface VoiceCommand {
  type: 'agent_task' | 'control' | 'query';
  agent?: string;          // Target agent (claude, openclaw, etc.)
  action?: string;         // For control commands (stop, pause, etc.)
  payload: string;         // The actual command/message
  raw: string;             // Original transcript
}

// Intent patterns
const INTENT_PATTERNS = [
  { pattern: /^(hey |ok )?claude[,:]?\s+(.+)/i, type: 'agent_task', agent: 'claude' },
  { pattern: /^(stop|cancel|pause)$/i, type: 'control', action: 'stop' },
  { pattern: /^switch to (\w+)$/i, type: 'control', action: 'switch_agent' },
  { pattern: /^what('s| is) the status/i, type: 'query', action: 'status' },
];
```

---

## Implementation Phases

### Phase 1: Foundation (Week 1)
- [ ] Create `packages/speech/` structure
- [ ] Implement SpeechBus abstraction
- [ ] Add Silero VAD integration
- [ ] Basic Whisper STT (via whisper.cpp or faster-whisper)
- [ ] Basic Kokoro TTS (CPU-friendly)
- [ ] Electron microphone access

**Deliverable:** Push-to-talk that transcribes and speaks back "I heard: {transcript}"

### Phase 2: Agent Integration (Week 2)
- [ ] Voice command router with intent parsing
- [ ] Connect to existing session manager
- [ ] Agent response → TTS pipeline
- [ ] Interrupt handling (user speaks → pause TTS)
- [ ] Basic voice personas per agent

**Deliverable:** "Hey Claude, list the files" → Claude runs, speaks summary

### Phase 3: Quality & Polish (Week 3)
- [ ] Fish S2 integration for high-quality TTS
- [ ] Smart summarization (don't read entire output)
- [ ] Streaming TTS (start speaking before full response)
- [ ] Visual feedback (waveform, speaking indicator)
- [ ] Settings UI (voice selection, push-to-talk key)

**Deliverable:** Production-quality voice interaction

### Phase 4: Advanced Features (Week 4+)
- [ ] Wake word detection ("Hey Dispatch")
- [ ] Multi-speaker diarization
- [ ] Voice cloning (user's voice for custom agents)
- [ ] Conversation memory ("do that again")
- [ ] Code-aware speech (spell out symbols, preserve casing)

---

## UI Components

### Push-to-Talk Button

```
┌─────────────────────────────────┐
│  🎤  Hold Space to speak        │  ← Idle state
└─────────────────────────────────┘

┌─────────────────────────────────┐
│  ◉ ▁▃▅▇▅▃▁  Listening...       │  ← Active state (waveform)
└─────────────────────────────────┘

┌─────────────────────────────────┐
│  ⏳ Processing...               │  ← Transcribing
└─────────────────────────────────┘
```

### Speaking Indicator

```
┌──────────────────────────────────────┐
│  🔊 Claude: "I'll refactor the..."  │  ← Agent speaking
│  [Stop]                              │
└──────────────────────────────────────┘
```

### Voice Settings Panel

```
┌─────────────────────────────────────────────┐
│  Voice Settings                              │
├─────────────────────────────────────────────┤
│  STT Engine:    [Distil-Whisper ▼]          │
│  TTS Engine:    [Fish S2 ▼]                 │
│  Claude Voice:  [Aria (thoughtful) ▼]       │
│  System Voice:  [Bella (neutral) ▼]         │
│  Push-to-Talk:  [Space]  [Change...]        │
│  ☑ Auto-speak agent responses               │
│  ☑ Interrupt TTS when I speak              │
└─────────────────────────────────────────────┘
```

---

## Caching Strategy

### TTS Cache
- Key: `hash(text + voiceId + style)`
- Storage: Local filesystem (`~/.dispatch/speech-cache/`)
- Eviction: LRU, max 500MB
- Pre-cache common phrases: "Done", "Working on it", "I found an error"

### STT Model Cache
- Download models on first use
- Store in `~/.dispatch/models/`
- Whisper: ~1.5GB, Kokoro: ~200MB

---

## Performance Targets

| Metric | Target | Notes |
|--------|--------|-------|
| STT latency (final) | <500ms | From speech end to transcript |
| STT latency (partial) | <200ms | For streaming feedback |
| TTS latency (first audio) | <300ms | From text to first sound |
| VAD latency | <50ms | Speech detection |
| Memory (idle) | <100MB | When not speaking/listening |
| Memory (active) | <500MB | During inference |

---

## Configuration

```typescript
// packages/speech/src/config.ts
interface SpeechConfig {
  stt: {
    backend: 'whisper' | 'parakeet';
    model: 'tiny' | 'base' | 'small' | 'medium' | 'large';
    language: string;  // 'en', 'auto'
    mode: 'code' | 'chat' | 'meeting';
  };
  tts: {
    backend: 'fish-s2' | 'kokoro' | 'chatterbox';
    defaultVoice: string;
    speakAgentResponses: boolean;
    interruptOnUserSpeech: boolean;
  };
  input: {
    pushToTalkKey: string;  // 'Space', 'F1', etc.
    enableWakeWord: boolean;
    wakeWord: string;  // 'hey dispatch'
  };
  cache: {
    enabled: boolean;
    maxSizeMB: number;
    directory: string;
  };
}
```

---

## Dependencies

```json
{
  "dependencies": {
    "@anthropic-ai/sdk": "^0.78.0",  // For summarization
    "onnxruntime-node": "^1.21.0",   // For Silero VAD, Whisper
    "web-audio-api": "^0.2.2"        // For audio processing
  },
  "optionalDependencies": {
    "whisper-node": "^1.0.0",        // Whisper.cpp bindings
    "fish-speech": "^0.1.0",         // Fish S2 (if available as npm)
    "kokoro-js": "^0.1.0"            // Kokoro TTS
  }
}
```

---

## Open Questions

1. **Model hosting**: Run locally (GPU required for quality) or offer cloud fallback?
2. **Wake word**: Worth the complexity for V1, or stick with push-to-talk?
3. **Voice cloning**: Allow users to clone their own voice for agents?
4. **Multi-language**: Support non-English voice commands in V1?
5. **Mobile/web**: Electron-only for V1, or design for web compatibility?

---

## Success Metrics

- **Engagement**: % of sessions using voice at least once
- **Retention**: Users who use voice in week 2 after first use
- **Task completion**: Voice command → successful agent task rate
- **Latency satisfaction**: <5% of users report "too slow"

---

## References

- [Fish Speech S2](https://github.com/fishaudio/fish-speech)
- [Chatterbox](https://github.com/resemble-ai/chatterbox)
- [Kokoro TTS](https://github.com/hexgrad/kokoro)
- [Whisper.cpp](https://github.com/ggerganov/whisper.cpp)
- [Silero VAD](https://github.com/snakers4/silero-vad)
- [Parakeet TDT](https://docs.nvidia.com/nemo-framework/user-guide/latest/nemotoolkit/asr/models.html)
