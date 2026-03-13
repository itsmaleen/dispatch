/**
 * Runtime access for ACC channel
 */

let accRuntime: any = null;

export function setAccRuntime(runtime: any) {
  accRuntime = runtime;
}

export function getAccRuntime() {
  if (!accRuntime) {
    throw new Error("ACC runtime not initialized");
  }
  return accRuntime;
}
