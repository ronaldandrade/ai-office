import assert from 'node:assert/strict';
import os from 'node:os';
import { describe, it } from 'node:test';
import {
  buildMeetingPrompt,
  MeetingManager,
  resolveTargetParticipants,
} from './meetingManager.ts';
import type { RunnerCallbacks } from './agentRunner.ts';
import type {
  AgentRecord,
  CliProviderInfo,
  WsServerMessage,
} from './types.ts';
import { DESK_SLOTS, MEETING_SPOTS, WALKABLE_GRID } from '../src/engine/officeMap.ts';
import { findPath } from '../src/engine/pathfinding.ts';
import { createInitialEntity, stepLifeSimulation } from '../src/engine/lifeSimulation.ts';

function makeAgent(id: string, name: string, roleTitle: string): AgentRecord {
  return {
    id,
    name,
    roleTitle,
    provider: 'demo',
    origin: 'manual',
    cwd: os.homedir(),
    deskIndex: 0,
    appearance: {
      hairColor: '#1f2937',
      skinColor: '#f1c27d',
      shirtColor: '#3b82f6',
      pantsColor: '#1e293b',
      accessory: 'none',
    },
    status: 'idle',
    messages: [],
  };
}

const DEMO_PROVIDERS: CliProviderInfo[] = [
  {
    id: 'demo',
    name: 'Modo Simulação',
    binary: 'builtin',
    installed: true,
    description: 'Demo',
    defaultArgsTemplate: '',
    accentColor: '#38bdf8',
  },
];

class MockRunner {
  calls: Array<{ agentId: string; prompt: string; cwd: string; callbacks: RunnerCallbacks }> = [];
  abortedIds: string[] = [];
  private active = new Set<string>();
  autoComplete = true;

  isRunning(agentId: string): boolean {
    return this.active.has(agentId);
  }

  abort(agentId: string): boolean {
    this.abortedIds.push(agentId);
    return this.active.delete(agentId);
  }

  run(
    agent: AgentRecord,
    _provider: CliProviderInfo,
    prompt: string,
    cwd: string,
    callbacks: RunnerCallbacks
  ): void {
    this.active.add(agent.id);
    this.calls.push({ agentId: agent.id, prompt, cwd, callbacks });
    if (this.autoComplete) {
      callbacks.onActivity('Analisando...');
      callbacks.onChunk(`Resposta de ${agent.name} (turno #${this.calls.length})`);
      this.active.delete(agent.id);
      callbacks.onDone('done');
    }
  }
}

describe('resolveTargetParticipants', () => {
  const agents = [
    makeAgent('a1', 'Cláudio', 'Arquiteto'),
    makeAgent('a2', 'Nova', 'Frontend'),
    makeAgent('a3', 'Gema', 'QA'),
  ];

  it('returns all participants when there are no @mentions', () => {
    const res = resolveTargetParticipants('Vamos revisar o código?', agents);
    assert.deepEqual(res.map((a) => a.id), ['a1', 'a2', 'a3']);
  });

  it('filters to @mentioned participants (accent- and case-insensitive)', () => {
    const res = resolveTargetParticipants('@claudio e @NOVA podem opinar?', agents);
    assert.deepEqual(res.map((a) => a.id), ['a1', 'a2']);
  });

  it('falls back to all participants when @mention matches nobody', () => {
    const res = resolveTargetParticipants('Oi @desconhecido, tudo bem?', agents);
    assert.deepEqual(res.map((a) => a.id), ['a1', 'a2', 'a3']);
  });
});

describe('MeetingManager orchestration', () => {
  it('validates participants and workspace on startMeeting', () => {
    const agents = [makeAgent('a1', 'Cláudio', 'Arquiteto')];
    const runner = new MockRunner();
    const events: WsServerMessage[] = [];
    const manager = new MeetingManager({
      getAgents: () => agents,
      getProviders: () => DEMO_PROVIDERS,
      getDefaultCwd: () => os.homedir(),
      runner,
      broadcast: (m) => events.push(m),
      turnGapMs: 0,
    });

    const emptyRes = manager.startMeeting({ participantIds: [] });
    assert.equal(emptyRes.ok, false);

    const invalidIdRes = manager.startMeeting({ participantIds: ['does-not-exist'] });
    assert.equal(invalidIdRes.ok, false);

    const outsideCwdRes = manager.startMeeting({
      participantIds: ['a1'],
      cwd: '/etc',
    });
    assert.equal(outsideCwdRes.ok, false);

    const okRes = manager.startMeeting({
      participantIds: ['a1', 'a1'],
      topic: 'Revisão de Arquitetura',
      maxRounds: 2,
    });
    assert.equal(okRes.ok, true);
    assert.deepEqual(manager.getState().participantIds, ['a1']);
    assert.equal(manager.getState().active, true);
    assert.equal(manager.getState().maxRounds, 2);
  });

  it('passes previous agents responses into subsequent speakers prompts across rounds', () => {
    const agents = [
      makeAgent('a1', 'Cláudio', 'Backend'),
      makeAgent('a2', 'Nova', 'Frontend'),
    ];
    const runner = new MockRunner();
    const events: WsServerMessage[] = [];
    const manager = new MeetingManager({
      getAgents: () => agents,
      getProviders: () => DEMO_PROVIDERS,
      getDefaultCwd: () => os.homedir(),
      runner,
      broadcast: (m) => events.push(m),
      turnGapMs: 0,
    });

    manager.startMeeting({
      participantIds: ['a1', 'a2'],
      topic: 'API Design',
      maxRounds: 2,
    });

    const sendRes = manager.sendMessage({ content: 'Qual formato de API devemos usar?', rounds: 2 });
    assert.equal(sendRes.ok, true);

    // 2 agents * 2 rounds = 4 sequential turns
    assert.equal(runner.calls.length, 4);
    assert.deepEqual(
      runner.calls.map((c) => c.agentId),
      ['a1', 'a2', 'a1', 'a2']
    );

    // Turn 2 (Nova) must see Turn 1 (Cláudio)'s reply in its prompt!
    assert.match(runner.calls[1].prompt, /Resposta de Cláudio \(turno #1\)/);
    // Turn 3 (Cláudio round 2) must see Nova's round 1 reply!
    assert.match(runner.calls[2].prompt, /Resposta de Nova \(turno #2\)/);
    // Turn 4 (Nova round 2) must see Cláudio's round 2 reply!
    assert.match(runner.calls[3].prompt, /Resposta de Cláudio \(turno #3\)/);

    // Meeting returns to idle after all turns finish
    assert.equal(manager.getState().status, 'idle');
    assert.equal(manager.getState().currentSpeakerId, undefined);
  });

  it('rejects concurrent sendMessage and cleanly aborts mid-turn ignoring stale callbacks', () => {
    const agents = [
      makeAgent('a1', 'Cláudio', 'Backend'),
      makeAgent('a2', 'Nova', 'Frontend'),
    ];
    const runner = new MockRunner();
    runner.autoComplete = false;
    const events: WsServerMessage[] = [];
    const manager = new MeetingManager({
      getAgents: () => agents,
      getProviders: () => DEMO_PROVIDERS,
      getDefaultCwd: () => os.homedir(),
      runner,
      broadcast: (m) => events.push(m),
      turnGapMs: 0,
    });

    manager.startMeeting({ participantIds: ['a1', 'a2'] });
    assert.equal(manager.sendMessage({ content: 'Vamos debater?' }).ok, true);
    assert.equal(manager.getState().status, 'running');
    assert.equal(manager.getState().currentSpeakerId, 'a1');
    assert.equal(manager.isAgentBusyInMeeting('a1'), true);

    // Second message while running must be rejected
    const busyRes = manager.sendMessage({ content: 'Outra pergunta' });
    assert.equal(busyRes.ok, false);

    // Abort mid-turn
    const firstTurnCallbacks = runner.calls[0].callbacks;
    manager.abortRound();

    assert.deepEqual(runner.abortedIds, ['a1']);
    assert.equal(manager.getState().status, 'idle');
    assert.equal(agents[0].status, 'idle');

    // Stale late callbacks from aborted process must NOT start Nova or mutate state
    firstTurnCallbacks.onChunk('late chunk');
    firstTurnCallbacks.onDone('aborted');
    assert.equal(runner.calls.length, 1);
    assert.equal(manager.getState().status, 'idle');
  });

  it('advances cleanly when current speaker is removed mid-round', () => {
    let agents = [
      makeAgent('a1', 'Cláudio', 'Backend'),
      makeAgent('a2', 'Nova', 'Frontend'),
    ];
    const runner = new MockRunner();
    runner.autoComplete = false;
    const manager = new MeetingManager({
      getAgents: () => agents,
      getProviders: () => DEMO_PROVIDERS,
      getDefaultCwd: () => os.homedir(),
      runner,
      broadcast: () => {},
      turnGapMs: 0,
    });

    manager.startMeeting({ participantIds: ['a1', 'a2'] });
    manager.sendMessage({ content: 'Quem assume?' });
    assert.equal(manager.getState().currentSpeakerId, 'a1');

    // Remove a1 while a1 is speaking
    agents = [agents[1]];
    manager.handleAgentsRemoved(new Set(['a2']));

    // Should have aborted a1 and immediately moved to a2
    assert.deepEqual(runner.abortedIds, ['a1']);
    assert.equal(manager.getState().currentSpeakerId, 'a2');
    assert.deepEqual(manager.getState().participantIds, ['a2']);
  });

  it('cleanly deactivates meeting when the last remaining participant is removed while speaking', () => {
    let agents = [makeAgent('a1', 'Cláudio', 'Backend')];
    const runner = new MockRunner();
    runner.autoComplete = false;
    const manager = new MeetingManager({
      getAgents: () => agents,
      getProviders: () => DEMO_PROVIDERS,
      getDefaultCwd: () => os.homedir(),
      runner,
      broadcast: () => {},
      turnGapMs: 0,
    });

    manager.startMeeting({ participantIds: ['a1'] });
    assert.equal(manager.sendMessage({ content: 'Oi' }).ok, true);
    assert.equal(manager.getState().status, 'running');
    assert.equal(manager.getState().currentSpeakerId, 'a1');

    // Remove the last participant while they are actively speaking
    agents = [];
    manager.handleAgentsRemoved(new Set());

    const state = manager.getState();
    assert.deepEqual(runner.abortedIds, ['a1']);
    assert.equal(state.active, false);
    assert.equal(state.status, 'idle');
    assert.equal(state.currentSpeakerId, undefined);
    assert.deepEqual(state.participantIds, []);
    assert.ok(
      state.messages.some(
        (m) => m.senderType === 'system' && m.content.includes('encerrada automaticamente')
      )
    );
  });

  it('guards against conflicts between queued meeting participants and individual tasks', () => {
    const agents = [
      makeAgent('a1', 'Cláudio', 'Backend'),
      makeAgent('a2', 'Nova', 'Frontend'),
    ];
    const runner = new MockRunner();
    runner.autoComplete = false;
    const manager = new MeetingManager({
      getAgents: () => agents,
      getProviders: () => DEMO_PROVIDERS,
      getDefaultCwd: () => os.homedir(),
      runner,
      broadcast: () => {},
      turnGapMs: 0,
    });

    manager.startMeeting({ participantIds: ['a1', 'a2'] });

    // Simulate a2 already running an individual task before sendMessage
    runner.run(agents[1], DEMO_PROVIDERS[0], 'tarefa individual', os.homedir(), {
      onActivity: () => {},
      onChunk: () => {},
      onDone: () => {},
    });
    const conflictRes = manager.sendMessage({ content: 'Debate geral' });
    assert.equal(conflictRes.ok, false);
    assert.equal(manager.getState().status, 'idle');
    // User message must NOT have been appended on rejection
    assert.equal(
      manager.getState().messages.some((m) => m.senderType === 'user'),
      false
    );

    // Clear individual task on a2, start meeting round -> BOTH a1 (speaking) and a2 (queued) are busy
    runner.abort('a2');
    assert.equal(manager.sendMessage({ content: 'Debate geral' }).ok, true);
    assert.equal(manager.isAgentBusyInMeeting('a1'), true);
    assert.equal(manager.isAgentBusyInMeeting('a2'), true);
  });

  it('bounds transcript length in buildMeetingPrompt', () => {
    const a1 = makeAgent('a1', 'Cláudio', 'Backend');
    const hugeMessages = Array.from({ length: 30 }, (_, i) => ({
      id: `m-${i}`,
      senderType: 'user' as const,
      senderName: 'Você',
      content: `Mensagem ${i}: ` + 'x'.repeat(1000),
      timestamp: Date.now() + i,
      status: 'done' as const,
    }));

    const prompt = buildMeetingPrompt(
      a1,
      [a1],
      {
        active: true,
        topic: 'Teste',
        participantIds: ['a1'],
        cwd: os.homedir(),
        status: 'running',
        currentRound: 1,
        maxRounds: 1,
        messages: hugeMessages,
      },
      1,
      1
    );

    assert.ok(prompt.length < 12_500, `Prompt too large: ${prompt.length}`);
    assert.match(prompt, /Mensagem 29:/);
  });
});

describe('Office map & lifeSimulation meeting behavior', () => {
  it('all MEETING_SPOTS are walkable and reachable from every desk', () => {
    for (const spot of MEETING_SPOTS) {
      assert.equal(
        WALKABLE_GRID[spot.ty]?.[spot.tx],
        true,
        `Meeting spot (${spot.tx}, ${spot.ty}) must be walkable`
      );
      for (const desk of DESK_SLOTS) {
        const path = findPath(desk.seatTx, desk.seatTy, spot.tx, spot.ty);
        assert.ok(
          path.length > 0,
          `No path from desk ${desk.index} to meeting spot (${spot.tx}, ${spot.ty})`
        );
      }
    }
  });

  it('moves meeting participants to lounge spots and keeps them there while speaking', () => {
    const a1 = makeAgent('a1', 'Cláudio', 'Backend');
    const a2 = makeAgent('a2', 'Nova', 'Frontend');
    a2.deskIndex = 1;
    const entities = new Map([
      [a1.id, createInitialEntity(a1)],
      [a2.id, createInitialEntity(a2)],
    ]);

    const activeMeeting = {
      active: true,
      topic: 'Sync',
      participantIds: ['a1', 'a2'],
      cwd: os.homedir(),
      status: 'running' as const,
      currentSpeakerId: 'a1',
      currentRound: 1,
      maxRounds: 1,
      messages: [],
    };

    // Simulate a1 speaking (working) during active meeting
    a1.status = 'working';

    // Step simulation enough seconds for agents to walk to lounge
    for (let i = 0; i < 120; i++) {
      stepLifeSimulation(0.1, [a1, a2], entities, 1, activeMeeting);
    }

    assert.equal(entities.get('a1')!.activity, 'in_meeting');
    assert.equal(entities.get('a2')!.activity, 'in_meeting');
    assert.equal(entities.get('a1')!.x, MEETING_SPOTS[0].tx);
    assert.equal(entities.get('a1')!.y, MEETING_SPOTS[0].ty);
    assert.equal(entities.get('a2')!.x, MEETING_SPOTS[1].tx);
    assert.equal(entities.get('a2')!.y, MEETING_SPOTS[1].ty);

    // End meeting -> agents transition out of in_meeting
    stepLifeSimulation(0.1, [a1, a2], entities, 1, {
      ...activeMeeting,
      active: false,
      status: 'idle',
    });
    assert.notEqual(entities.get('a2')!.activity, 'in_meeting');
  });

  it('re-routes a walking participant smoothly when their meeting spot index shifts mid-walk', () => {
    const a1 = makeAgent('a1', 'Cláudio', 'Backend');
    const a2 = makeAgent('a2', 'Nova', 'Frontend');
    a2.deskIndex = 1;
    const entities = new Map([
      [a1.id, createInitialEntity(a1)],
      [a2.id, createInitialEntity(a2)],
    ]);

    const meetingTwo = {
      active: true,
      topic: 'Sync',
      participantIds: ['a1', 'a2'],
      cwd: os.homedir(),
      status: 'idle' as const,
      currentRound: 0,
      maxRounds: 1,
      messages: [],
    };

    stepLifeSimulation(0.1, [a1, a2], entities, 1, meetingTwo);
    assert.equal(entities.get('a2')!.activity, 'walking_to_meeting');
    assert.deepEqual(entities.get('a2')!.path.at(-1), {
      tx: MEETING_SPOTS[1].tx,
      ty: MEETING_SPOTS[1].ty,
    });

    // Remove a1 mid-walk -> a2 shifts from spot 1 to spot 0
    stepLifeSimulation(0.1, [a2], entities, 1, {
      ...meetingTwo,
      participantIds: ['a2'],
    });
    assert.equal(entities.get('a2')!.activity, 'walking_to_meeting');
    assert.deepEqual(entities.get('a2')!.path.at(-1), {
      tx: MEETING_SPOTS[0].tx,
      ty: MEETING_SPOTS[0].ty,
    });
  });
});
