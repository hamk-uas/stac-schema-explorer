import { DATA_FORMATS } from './conventions';
import type { Layer } from './layers';
import { CORE } from './model';

/**
 * The cores that STAC documents and data files are built on: STAC itself, and the formats of data files. Like
 * extensions and conventions, a selected core shows its fields; its documents or nodes are shown either way. COG is a
 * layout profile of TIFF, adding no fields of its own.
 */
export interface Core {
    id: string;
    title: string;
    layer: Extract<Layer, 'standard' | 'format'>;
    /** Source key of its fields: `core` for STAC, the format schema for a format. */
    source: string;
    description: string;
}

export const CORES: readonly Core[] = [
    { id: 'stac', title: 'STAC', layer: 'standard', source: CORE, description: 'Catalogs, Collections and Items: the fields of the STAC specification itself.' },
    ...DATA_FORMATS.map((format): Core => ({ id: format.id, title: format.title, layer: 'format', source: format.schema, description: format.description })),
];

export const ALL_CORES: readonly string[] = CORES.map((core) => core.id);

/** The core whose fields come from a source (STAC core or a format schema). */
export const coreOfSource = (source: string) => CORES.find((core) => core.source === source);
