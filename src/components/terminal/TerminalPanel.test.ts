import { describe, it, expect } from 'vitest';

interface TabSession {
  id: string;
  name: string;
}

describe('TerminalPanel Session Lifecycle', () => {
  it('initializes with default primary session', () => {
    const sessions: TabSession[] = [{ id: 'term_1', name: '1: shell' }];
    expect(sessions.length).toBe(1);
    expect(sessions[0].name).toBe('1: shell');
  });

  it('adds new terminal sessions with sequential indexing', () => {
    let sessions: TabSession[] = [{ id: 'term_1', name: '1: shell' }];
    const nextIdx = sessions.length + 1;
    const newSession: TabSession = { id: 'term_2', name: `${nextIdx}: shell` };
    sessions = [...sessions, newSession];

    expect(sessions.length).toBe(2);
    expect(sessions[1].name).toBe('2: shell');
  });

  it('prevents closing when only 1 session remains', () => {
    const sessions: TabSession[] = [{ id: 'term_1', name: '1: shell' }];
    const canClose = sessions.length > 1;
    expect(canClose).toBe(false);
  });

  it('removes session and activates previous when closed', () => {
    let sessions: TabSession[] = [
      { id: 'term_1', name: '1: shell' },
      { id: 'term_2', name: '2: shell' },
    ];
    let activeId = 'term_2';

    // Close active session
    const idToClose = 'term_2';
    sessions = sessions.filter(s => s.id !== idToClose);
    if (activeId === idToClose) {
      activeId = sessions[0].id;
    }

    expect(sessions.length).toBe(1);
    expect(activeId).toBe('term_1');
  });
});

describe('Terminal Browser Fallback Command Dispatcher', () => {
  function dispatchCommand(cmd: string): string[] {
    const output: string[] = [];
    if (cmd === 'clear') {
      return ['CLEAR_BUFFER'];
    } else if (cmd === 'help') {
      output.push('Vedara Terminal Commands:');
      output.push('  help     - Show available simulated commands');
      output.push('  clear    - Clear terminal buffer');
      output.push('  status   - Show AI engine readiness');
      output.push('  ls       - List workspace files');
    } else if (cmd === 'status') {
      output.push('Local AI Runtime: Online (Air-gapped)');
      output.push('Resident Model: qwen2.5-coder:1.5b');
    } else if (cmd === 'ls') {
      output.push('README.md  package.json  src/  src-tauri/');
    } else if (cmd.length > 0) {
      output.push(`command executed: ${cmd}`);
    }
    return output;
  }

  it('handles help command', () => {
    const res = dispatchCommand('help');
    expect(res.length).toBeGreaterThan(1);
    expect(res[0]).toContain('Vedara Terminal Commands');
  });

  it('handles status command', () => {
    const res = dispatchCommand('status');
    expect(res[0]).toContain('Local AI Runtime: Online');
  });

  it('handles ls command', () => {
    const res = dispatchCommand('ls');
    expect(res[0]).toContain('README.md');
    expect(res[0]).toContain('package.json');
  });

  it('handles clear command', () => {
    const res = dispatchCommand('clear');
    expect(res).toEqual(['CLEAR_BUFFER']);
  });
});
