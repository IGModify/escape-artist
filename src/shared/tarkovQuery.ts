// GraphQL query against https://api.tarkov.dev/graphql (schema: the-hideout/tarkov-api schema-static.mjs).
const ITEM = 'id name shortName iconLink';
const POS = 'x y z';
const ZONES = `zones { id map { id } position { ${POS} } }`;
/** Kill zones also need their outline, to draw the area. */
const AREAS = `zones { id map { id } position { ${POS} } outline { ${POS} } top bottom }`;
const KEYS = `requiredKeys { ${ITEM} }`;

export const TARKOV_QUERY = `{
  maps {
    id name normalizedName nameId
    spawns { zoneName sides categories position { ${POS} } }
    extracts { id name faction position { ${POS} } }
  }
  tasks {
    id name normalizedName minPlayerLevel kappaRequired wikiLink factionName
    trader { name normalizedName imageLink }
    map { id normalizedName }
    taskRequirements { task { id } status }
    objectives {
      id type description optional
      maps { id normalizedName }
      ... on TaskObjectiveBasic { ${ZONES} ${KEYS} }
      ... on TaskObjectiveMark { markerItem { ${ITEM} } ${ZONES} ${KEYS} }
      ... on TaskObjectiveItem { items { ${ITEM} } count foundInRaid ${ZONES} ${KEYS} }
      ... on TaskObjectiveQuestItem { questItem { ${ITEM} } count possibleLocations { map { id } positions { ${POS} } } ${ZONES} ${KEYS} }
      ... on TaskObjectiveShoot { targetNames count zoneNames usingWeapon { ${ITEM} } ${AREAS} ${KEYS} }
      ... on TaskObjectiveExtract { exitName count ${KEYS} }
      ... on TaskObjectiveUseItem { useAny { ${ITEM} } count ${ZONES} ${KEYS} }
    }
  }
}`;

export const MAPS_CONFIG_URL = 'https://raw.githubusercontent.com/the-hideout/tarkov-dev/main/src/data/maps.json';
export const TARKOV_API_URL = 'https://api.tarkov.dev/graphql';
