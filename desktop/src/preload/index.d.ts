/**
 * 渲染层可见的 window.pet 声明（与 preload/index.ts 保持一致）。
 */
import type { PetApiShape } from '../shared/pet-api'

declare global {
  interface Window {
    pet: PetApiShape
  }
}

export {}
