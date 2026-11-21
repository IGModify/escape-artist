import type { JsonFiles } from './jsonSource';

export const CUSTOMS = '56f40101d2720b2a4d8b45d6';
export const pos = (x: number, z: number) => ({ x, y: 1, z });

// Shapes copied from json.tarkov.dev/regular/* (trimmed).
export function sample(taskCount = 60): JsonFiles {
  const tasks: Record<string, unknown> = {};
  for (let i = 0; i < taskCount; i++) {
    tasks[`t${i}`] = { id: `t${i}`, name: `t${i} name`, normalizedName: `t${i}`, trader: 'tr1', minPlayerLevel: 1, taskRequirements: [], objectives: [], map: null };
  }
  tasks.t0 = {
    id: 't0', name: 't0 name', normalizedName: 'signal', trader: 'tr1', minPlayerLevel: 5, kappaRequired: true,
    wikiLink: 'https://wiki', factionName: 'Any', map: CUSTOMS,
    taskRequirements: [{ task: 't1', status: ['complete'] }],
    objectives: [
      { id: 'o1', description: 'o1', type: 'mark', optional: false, maps: [CUSTOMS], markerItem: 'ms2000',
        zones: [{ id: 'z', map: CUSTOMS, position: pos(10, 20), outline: [] }], requiredKeys: [['key114', 'master']] },
      { id: 'o2', description: 'o2', type: 'plantItem', optional: false, count: 2, items: ['jammer'], maps: [CUSTOMS],
        zones: [{ id: 'z2', map: CUSTOMS, position: pos(30, 40) }] },
      { id: 'o3', description: 'o3', type: 'findQuestItem', optional: false, count: 1, questItem: 'qdocs', maps: [CUSTOMS],
        possibleLocations: [{ map: CUSTOMS, positions: [pos(1, 2), pos(3, 4)] }] },
    ],
  };
  const maps: Record<string, unknown> = {};
  for (let i = 0; i < 5; i++) maps[`m${i}`] = { id: `m${i}`, name: `m${i} Name`, normalizedName: `map-${i}`, nameId: `m${i}`, spawns: [], extracts: [] };
  maps[CUSTOMS] = {
    id: CUSTOMS, name: `${CUSTOMS} Name`, normalizedName: 'customs', nameId: 'bigmap',
    spawns: [{ position: pos(5, 5), sides: ['pmc'], categories: ['player'], zoneName: 'ZoneBigRed' }],
    extracts: [{ id: 'e1', name: 'ex_zb', faction: 'pmc', position: pos(9, 9) }, { id: 'e2', name: 'ex_nopos', faction: 'shared', position: null }],
  };
  return {
    tasks: { data: { tasks, questItems: { qdocs: { id: 'qdocs', name: 'qdocs Name', shortName: 'qdocs ShortName', iconLink: 'https://assets.tarkov.dev/qdocs-icon.webp' } } } },
    tasks_en: { data: { 't0 name': 'Signal', o1: 'Mark the tanker', o2: 'Plant jammers', o3: 'Find the docs', 'qdocs Name': 'Secure folder', 'qdocs ShortName': 'Folder' } },
    maps: { data: { maps } },
    maps_en: { data: { [`${CUSTOMS} Name`]: 'Customs', ex_zb: 'ZB-1011' } },
    items_en: { data: { 'ms2000 Name': 'MS2000 Marker', 'ms2000 ShortName': 'MS2000', 'jammer Name': 'Signal Jammer', 'jammer ShortName': 'Jammer', 'key114 Name': 'Dorm room 114 key', 'key114 ShortName': '114', 'master Name': 'Master key', 'master ShortName': 'Master' } },
    traders: { data: { tr1: { id: 'tr1', name: 'tr1 Nickname', normalizedName: 'mechanic', imageLink: null } } },
    traders_en: { data: { 'tr1 Nickname': 'Mechanic' } },
  };
}

