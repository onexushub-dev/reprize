import { applyVoiceEngine, pickVoiceEngine, setVoiceEnginePref, voiceEngine } from '../voiceEngine';

const mockSetVoiceEngine = jest.fn();
let mockPrefs: Record<string, unknown> = {};

jest.mock('../../../modules/replay-camera', () => ({
  setVoiceEngine: (engine: string) => mockSetVoiceEngine(engine),
}));
jest.mock('../../data/mmkv', () => ({
  repo: {
    getPrefs: () => mockPrefs,
    setPrefs: (patch: Record<string, unknown>) => {
      mockPrefs = { ...mockPrefs, ...patch };
    },
  },
}));
jest.mock('../../diag/diagLog', () => ({ DIAGNOSTICS_ENABLED: true }));

beforeEach(() => {
  mockPrefs = {};
  mockSetVoiceEngine.mockReset();
});

describe('the voice engine switch', () => {
  it('stays on dictation in builds without diagnostics, whatever the saved choice', () => {
    expect(pickVoiceEngine(false, 'keyword')).toBe('dictation');
    expect(pickVoiceEngine(false, undefined)).toBe('dictation');
  });

  it('uses the model only when diagnostics are on and Diagnóstico chose it', () => {
    expect(pickVoiceEngine(true, 'keyword')).toBe('keyword');
    expect(pickVoiceEngine(true, 'dictation')).toBe('dictation');
    expect(pickVoiceEngine(true, undefined)).toBe('dictation');
  });

  it('defaults to dictation with nothing saved', () => {
    expect(voiceEngine()).toBe('dictation');
    applyVoiceEngine();
    expect(mockSetVoiceEngine).toHaveBeenCalledWith('dictation');
  });

  it('saves the choice and tells the native side at once', () => {
    setVoiceEnginePref('keyword');
    expect(mockPrefs.labVoiceEngine).toBe('keyword');
    expect(mockSetVoiceEngine).toHaveBeenLastCalledWith('keyword');
    setVoiceEnginePref('dictation');
    expect(mockSetVoiceEngine).toHaveBeenLastCalledWith('dictation');
  });

  it('never throws when the native side is missing or fails', () => {
    mockSetVoiceEngine.mockImplementation(() => {
      throw new Error('older build');
    });
    expect(() => applyVoiceEngine()).not.toThrow();
  });
});
