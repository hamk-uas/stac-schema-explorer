import registryDocument from '../../schemas/hamk-uas.github.io/stac-schema-explorer/schemas/registry.json';
import { CONVENTION_KINDS, conventionOfSchema, formatOfSchema } from './conventions';
import { describeUrl } from './extensions';
import { CORE } from './model';

/**
 * The layers where things are defined and used, from what a field is to what reads it:
 * a standard (STAC itself), a convention or extension that defines fields, a format that contains them, and the
 * software that reads or writes them: a driver of one format, a library, a package or application.
 */
export type Layer = 'standard' | 'convention' | 'format' | 'driver' | 'library' | 'package';

export const LAYERS: Record<Layer, { symbol: string; title: string; plural: string; about: string }> = {
    standard: { symbol: '📜', title: 'Standard', plural: 'Standards', about: 'a specification combining formats and conventions: STAC itself' },
    convention: { symbol: '🤝', title: 'Convention / extension', plural: 'Conventions and extensions', about: 'defines fields: STAC extensions, CF, ACDD, Zarr conventions, GeoTIFF keys, tool conventions' },
    format: { symbol: '💾', title: 'Format', plural: 'Formats', about: 'contains fields: Zarr v2 and v3, netCDF, TIFF' },
    driver: { symbol: '🔌', title: 'Driver', plural: 'Drivers', about: 'reads and writes one format inside a library: GDAL’s GTiff, netCDF and Zarr drivers' },
    library: { symbol: '🧰', title: 'Library', plural: 'Libraries', about: 'the data model and API programs use: GDAL, rasterio, xarray' },
    package: { symbol: '🖥️', title: 'Package / app', plural: 'Packages and apps', about: 'built on libraries: rioxarray, stackstac, odc-stac, TiTiler' },
};

/** When a specification or a program's claims were last checked, and the latest release then. */
export interface Checked {
    date: string;
    /** Latest release when checked (`latest` in the registry, `release` in the software list). */
    latest?: string;
    source?: string;
    note?: string;
}

/** Where a schema sits among the layers, and how current our information about it is. */
export interface SchemaLayer {
    layer: Layer;
    /** What kind of thing it is within its layer: STAC extension, Zarr convention, Attribute convention, … */
    kind: string;
    version?: string;
    maturity?: string;
    checked?: Checked;
}

interface RegistryChecked { date: string; latest?: string; source?: string; note?: string }
const formatChecked = new Map((registryDocument.formats as { id: string; checked?: RegistryChecked }[]).map((f) => [f.id, f.checked]));
const conventionStatus = new Map((registryDocument.conventions as { id: string; checked?: RegistryChecked; maturity?: string }[]).map((c) => [c.id, c]));

export function schemaLayer(source: string, version?: string): SchemaLayer | undefined {
    if (source === CORE) return { layer: 'standard', kind: 'STAC core', version };
    if (source.startsWith('?')) return undefined;
    const format = formatOfSchema(source);
    if (format) return { layer: 'format', kind: 'Data format', checked: formatChecked.get(format.id) };
    const known = conventionOfSchema(source);
    if (known) {
        const status = conventionStatus.get(known.convention.id);
        const kind = CONVENTION_KINDS.find((k) => k.kind === known.convention.kind)?.title.replace(/s$/, '') ?? 'Data convention';
        return { layer: 'convention', kind, version: known.version, maturity: status?.maturity, checked: status?.checked };
    }
    return { layer: 'convention', kind: 'STAC extension', version: version ?? describeUrl(source).version };
}

/** Whole months from an ISO date to `now`. */
export function monthsSince(date: string, now: Date = new Date()): number {
    const then = new Date(`${date}T00:00:00Z`);
    if (Number.isNaN(then.getTime())) return 0;
    const months = (now.getUTCFullYear() - then.getUTCFullYear()) * 12 + now.getUTCMonth() - then.getUTCMonth();
    return now.getUTCDate() < then.getUTCDate() ? months - 1 : months;
}

/** Checks older than this are flagged as possibly outdated. */
export const STALE_MONTHS = 3;

export const isStale = (date: string, now: Date = new Date()) => monthsSince(date, now) >= STALE_MONTHS;
