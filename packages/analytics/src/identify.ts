/**
 * Anonymous user identification for Merry telemetry.
 * 
 * Based on T3Code's approach:
 * 1. Try to get existing anonymous ID from state dir
 * 2. Generate new UUID if none exists
 * 3. Hash the ID for privacy
 */

import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

/**
 * Get the Merry state directory.
 * Creates it if it doesn't exist.
 */
function getStateDir(): string {
  const homeDir = os.homedir();
  const stateDir = path.join(homeDir, '.merry');
  
  if (!fs.existsSync(stateDir)) {
    fs.mkdirSync(stateDir, { recursive: true });
  }
  
  return stateDir;
}

/**
 * Generate a SHA-256 hash of a value.
 */
function hash(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

/**
 * Generate a random UUID v4.
 */
function generateUUID(): string {
  return crypto.randomUUID();
}

/**
 * Get or create an anonymous telemetry identifier.
 * 
 * Returns a hashed identifier that cannot be traced back to the user.
 * The raw UUID is stored locally for consistency across sessions.
 */
export function getTelemetryIdentifier(): string | null {
  try {
    const stateDir = getStateDir();
    const idPath = path.join(stateDir, 'anonymous-id');
    
    let anonymousId: string;
    
    if (fs.existsSync(idPath)) {
      anonymousId = fs.readFileSync(idPath, 'utf-8').trim();
    } else {
      anonymousId = generateUUID();
      fs.writeFileSync(idPath, anonymousId, 'utf-8');
    }
    
    // Return hashed ID for privacy
    return hash(anonymousId);
  } catch (error) {
    // Fail silently - telemetry is best-effort
    console.warn('[analytics] Failed to get telemetry identifier:', error);
    return null;
  }
}

/**
 * Clear the stored anonymous ID.
 * Useful for testing or user privacy requests.
 */
export function clearTelemetryIdentifier(): void {
  try {
    const stateDir = getStateDir();
    const idPath = path.join(stateDir, 'anonymous-id');
    
    if (fs.existsSync(idPath)) {
      fs.unlinkSync(idPath);
    }
  } catch (error) {
    console.warn('[analytics] Failed to clear telemetry identifier:', error);
  }
}
