import * as engine from '@tribunplay/engine';
import { DEFAULT_CLOCK_INPUT, type ClockInput, type LobbyTimeControlPayload } from '../clock/types';

export type RoomColorOption = 'black' | 'white' | 'random';
export type NextStartOption = 'same' | 'other' | 'random';
export type PlayMode = 'online' | 'local';

export type PlayLobbyFormValues = {
  hostColor: RoomColorOption;
  startColor: RoomColorOption;
  nextStartColor: NextStartOption;
  customSetupsEnabled: boolean;
  setupMode: engine.SetupMode;
  allowedTribunHeights: Array<1 | 2 | 3>;
  armyMin: number | '';
  armyMax: number | '';
  sameClockSettings: boolean;
  sharedClock: ClockInput;
  blackClock: ClockInput;
  whiteClock: ClockInput;
  maxGameEnabled: boolean;
  maxGameMinutesTotal: number | '';
  sharedSetupHash: string;
  sharedFlipBlack: boolean;
  sharedFlipWhite: boolean;
  freeBlackSetupHash: string;
  freeBlackFlip: boolean;
  freeWhiteSetupHash: string;
  freeWhiteFlip: boolean;
};

export type PlayLobbySubmitPayload = {
  timeControl: LobbyTimeControlPayload;
  roomSettings: {
    hostColor: RoomColorOption;
    startColor: RoomColorOption;
    nextStartColor: NextStartOption;
    setupConfig: engine.SetupConfig;
    setupSelections: engine.SetupSelectionsBySide;
  };
};

export type LocalLobbyPayload = {
  mode: 'local';
  createdAtMs: number;
  resolvedStartColor: 'black' | 'white';
  timeControl: LobbyTimeControlPayload;
  roomSettings: PlayLobbySubmitPayload['roomSettings'];
};

export const DEFAULT_PLAY_LOBBY_VALUES: PlayLobbyFormValues = {
  hostColor: 'random',
  startColor: 'random',
  nextStartColor: 'other',
  customSetupsEnabled: false,
  setupMode: 'shared',
  allowedTribunHeights: [1, 2, 3],
  armyMin: '',
  armyMax: '',
  sameClockSettings: true,
  sharedClock: { ...DEFAULT_CLOCK_INPUT },
  blackClock: { ...DEFAULT_CLOCK_INPUT },
  whiteClock: { ...DEFAULT_CLOCK_INPUT },
  maxGameEnabled: false,
  maxGameMinutesTotal: 60,
  sharedSetupHash: '',
  sharedFlipBlack: false,
  sharedFlipWhite: false,
  freeBlackSetupHash: '',
  freeBlackFlip: false,
  freeWhiteSetupHash: '',
  freeWhiteFlip: false,
};
