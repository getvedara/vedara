import { describe, it, expect, beforeEach } from 'vitest';
import { usePaletteStore } from './paletteStore';
import { PaletteCommand } from '../types/palette';

describe('Palette Store', () => {
  beforeEach(() => {
    usePaletteStore.setState({
      isOpen: false,
      mode: 'commands',
      query: '',
      selectedIndex: 0,
      commands: [],
    });
  });

  it('manages open/close/toggle lifecycle', () => {
    const store = usePaletteStore.getState();

    store.open('commands', 'git');
    expect(usePaletteStore.getState().isOpen).toBe(true);
    expect(usePaletteStore.getState().mode).toBe('commands');
    expect(usePaletteStore.getState().query).toBe('git');

    store.close();
    expect(usePaletteStore.getState().isOpen).toBe(false);
    expect(usePaletteStore.getState().query).toBe('');

    store.toggle('files');
    expect(usePaletteStore.getState().isOpen).toBe(true);
    expect(usePaletteStore.getState().mode).toBe('files');

    store.toggle();
    expect(usePaletteStore.getState().isOpen).toBe(false);
  });

  it('registers and unregisters individual commands', () => {
    const store = usePaletteStore.getState();

    const cmd: PaletteCommand = {
      id: 'test:command',
      title: 'Test Command',
      category: 'File',
      handler: () => {},
    };

    const unregister = store.registerCommand(cmd);
    expect(usePaletteStore.getState().commands).toHaveLength(1);
    expect(usePaletteStore.getState().commands[0].id).toBe('test:command');

    unregister();
    expect(usePaletteStore.getState().commands).toHaveLength(0);
  });

  it('registers multiple commands in batch', () => {
    const store = usePaletteStore.getState();

    const cmds: PaletteCommand[] = [
      { id: 'cmd:1', title: 'One', category: 'File', handler: () => {} },
      { id: 'cmd:2', title: 'Two', category: 'View', handler: () => {} },
    ];

    const unregister = store.registerCommands(cmds);
    expect(usePaletteStore.getState().commands).toHaveLength(2);

    unregister();
    expect(usePaletteStore.getState().commands).toHaveLength(0);
  });

  it('switches to commands mode when query starts with >', () => {
    const store = usePaletteStore.getState();
    store.open('files');
    expect(usePaletteStore.getState().mode).toBe('files');

    store.setQuery('>terminal');
    expect(usePaletteStore.getState().mode).toBe('commands');
    expect(usePaletteStore.getState().query).toBe('terminal');
  });

  it('navigates selected index with wraparound', () => {
    const store = usePaletteStore.getState();
    store.open();

    store.selectNext(3);
    expect(usePaletteStore.getState().selectedIndex).toBe(1);

    store.selectNext(3);
    expect(usePaletteStore.getState().selectedIndex).toBe(2);

    // Wraparound to 0
    store.selectNext(3);
    expect(usePaletteStore.getState().selectedIndex).toBe(0);

    // Wraparound backwards to 2
    store.selectPrevious(3);
    expect(usePaletteStore.getState().selectedIndex).toBe(2);
  });
});
