/**
 * Readers of the metadata embedded in data files, as the nodes this repository's format schemas describe (`netcdf`,
 * `tiff`). Other applications import this module as `stac-schema-explorer/readers`; it imports only files of this folder
 * and the packages `h5wasm`, `netcdfjs` and `geotiff`, which they provide.
 */
export type { Json, JsonObject, MetadataNode, ReaderNote } from './types';
export { decodeAttributes, readNetCDF, type AttributeValue, type H5Attribute, type H5Module, type ReadNetCDFOptions } from './netcdf';
export { decodeGeoKeys, parseGDALMetadata, readTiff, type ReadTiffResult } from './tiff';
