export interface UiSlotRegistration {
  id: string;
}

export interface AudioHook {
  id: string;
}

export interface SettingRegistration {
  id: string;
}

export interface IIPContext {
  instrumentId: string;
  registerUiSlot(slot: UiSlotRegistration): void;
  registerAudioHook(hook: AudioHook): void;
  registerSetting(setting: SettingRegistration): void;
  getState(): unknown;
  dispatch(action: unknown): void;
}

export interface IIP {
  id: string;
  version: string;
  appliesTo: "*" | readonly string[];
  register(ctx: IIPContext): void;
}
