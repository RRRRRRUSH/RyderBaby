import { contextBridge, ipcRenderer } from 'electron'
import type { PetApiShape } from '../shared/pet-api'

const api: PetApiShape = {
  getState: () => ipcRenderer.invoke('pet:get-state'),
  getSettings: () => ipcRenderer.invoke('pet:get-settings'),
  setSettings: (patch: unknown) => ipcRenderer.invoke('pet:set-settings', patch),
  testPush: () => ipcRenderer.invoke('pet:test-push'),
  listChannels: () => ipcRenderer.invoke('pet:list-channels'),
  listAgents: () => ipcRenderer.invoke('pet:list-agents'),
  getTokenHistory: (opts?: { bucket?: 'hour' | 'day'; days?: number }) =>
    ipcRenderer.invoke('pet:get-token-history', opts),
  setMuted: (muted: boolean) => ipcRenderer.invoke('pet:set-muted', muted),
  setPaused: (paused: boolean) => ipcRenderer.invoke('pet:set-paused', paused),
  minimizeWindow: () => ipcRenderer.invoke('pet:minimize-window'),
  closeWindow: () => ipcRenderer.invoke('pet:close-window'),
  quit: () => ipcRenderer.invoke('pet:quit'),
  onEvent: (channel: string, cb: (payload: unknown) => void) => {
    const listener = (_e: Electron.IpcRendererEvent, payload: unknown) => cb(payload)
    ipcRenderer.on(channel, listener)
    return () => ipcRenderer.removeListener(channel, listener)
  }
}

contextBridge.exposeInMainWorld('pet', api)
