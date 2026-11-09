import { onFileRemoved, removeFile } from '../mmkv';

const mockDeleted: string[] = [];
jest.mock('expo-file-system', () => ({
  File: class {
    mockUri: string;
    constructor(mockPath: string) {
      this.mockUri = mockPath;
    }
    delete() {
      mockDeleted.push(this.mockUri);
    }
  },
}));
jest.mock('react-native-mmkv', () => ({
  createMMKV: () => ({ getString: () => undefined, set: () => {}, remove: () => {}, getAllKeys: () => [] }),
}));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'id' }));


test('deleting a clip also deletes its thumbnail, its Modo Foco file and its Seguir a Bola files', () => {
  removeFile('/docs/clips/ABC.mp4');
  expect(mockDeleted).toEqual(
    expect.arrayContaining([
      'file:///docs/clips/ABC.mp4',
      'file:///docs/clips/ABC.thumb.jpg',
      'file:///docs/clips/ABC.focus.json',
      'file:///docs/clips/ABC.ball.json',
      'file:///docs/clips/ABC.balldet.json',
    ]),
  );
});

test('whoever listens hears which clip file is being deleted', () => {
  const heard: string[] = [];
  const stop = onFileRemoved((path) => heard.push(path));
  removeFile('/docs/clips/XYZ.mp4');
  stop();
  removeFile('/docs/clips/LATER.mp4');
  expect(heard).toEqual(['/docs/clips/XYZ.mp4']);
});

test('the Documents folder address becomes a plain path ending in a slash', () => {
  const { documentsPath } = jest.requireActual('../mmkv');
  expect(documentsPath('file:///var/mobile/Containers/Data/Application/A%20B/Documents/')).toBe(
    '/var/mobile/Containers/Data/Application/A B/Documents/',
  );
  expect(documentsPath('file:///var/x/Documents')).toBe('/var/x/Documents/');
});
