/** JSON as the readers produce it; the same shape as the app's `Json`, kept here so the readers import nothing outside this folder. */
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type JsonObject = { [key: string]: Json };

/** A node of embedded metadata read from a file: its path (`''` for the root) and the node as JSON. */
export interface MetadataNode {
    path: string;
    node: JsonObject;
}

/** What a reader left out, as a code with parameters, so that applications can word it in their own languages. */
export type ReaderNote =
    /** Tag values shown by their length only (`tags`: their names, comma-separated). */
    | { code: 'deferred-values'; params: { tags: string } }
    /** Only the first `count` of `total` images were read. */
    | { code: 'truncated'; params: { count: number; total: number } };
