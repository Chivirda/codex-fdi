import type { StylesProfile, FileMetadata } from '../shared/project-styles';
import { CSS_LIMITS } from '../shared/project-styles';

export const DEFAULT_STYLES_PROFILE: StylesProfile = { version: 1, name: 'Project', remBase: 10, files: [] };
/** Tight metadata-only whitelist. Raw CSS and indexes are never accepted for clientStorage. */
export function parseStylesProfile(value: unknown): StylesProfile | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const profile = value as Partial<StylesProfile>;
  if (profile.version !== 1 || typeof profile.name !== 'string' || !profile.name.trim() || profile.name.length > 80
    || typeof profile.remBase !== 'number' || !Number.isFinite(profile.remBase) || profile.remBase <= 0
    || !Array.isArray(profile.files) || profile.files.length > CSS_LIMITS.files) return undefined;
  const files: FileMetadata[] = [];
  for (const file of profile.files) {
    if (!file || typeof file !== 'object' || typeof file.id !== 'string' || !file.id || file.id.length > 255
      || typeof file.name !== 'string' || !file.name || file.name.length > 255
      || !['bytes', 'importedAt', 'rules', 'classes', 'variables'].every(key => {
        const number = file[key as keyof FileMetadata];
        return typeof number === 'number' && Number.isFinite(number) && number >= 0;
      }) || file.bytes > CSS_LIMITS.fileBytes || file.rules > CSS_LIMITS.rules) return undefined;
    files.push({ id: file.id, name: file.name, bytes: file.bytes, importedAt: file.importedAt, rules: file.rules, classes: file.classes, variables: file.variables });
  }
  if (new Set(files.map(file => file.id)).size !== files.length) return undefined;
  return { version: 1, name: profile.name, remBase: profile.remBase, files };
}
