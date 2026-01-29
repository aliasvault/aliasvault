// Base
export { BaseRepository, type IDatabaseClient, type SqliteBindValue } from './BaseRepository';

// Mappers
export { FieldMapper, type FieldRow } from './mappers/FieldMapper';
export { ItemMapper, type ItemRow, type TagRow } from './mappers/ItemMapper';
export { PasskeyMapper, type PasskeyRow, type PasskeyWithItemRow, type PasskeyWithItem } from './mappers/PasskeyMapper';

// Queries
export {
  ItemQueries,
  FieldValueQueries,
  FieldDefinitionQueries,
  FieldHistoryQueries
} from './queries/ItemQueries';

// Repositories
export { ItemRepository } from './repositories/ItemRepository';
export { PasskeyRepository } from './repositories/PasskeyRepository';
export { FolderRepository, type Folder } from './repositories/FolderRepository';
export { SettingsRepository } from './repositories/SettingsRepository';
export { LogoRepository } from './repositories/LogoRepository';
