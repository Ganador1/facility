type ManifestFile = {
    path: string;
    sha256: string;
};
type Manifest = {
    version: 1;
    files: ManifestFile[];
    manifestHash: string;
};
declare function sha256Hex(content: string): string;
declare function manifestFor(files: {
    path: string;
    content: string;
}[]): Manifest;
declare function diffManifest(expected: Manifest, actual: Manifest, managedPaths?: string[]): {
    missing: string[];
    modified: string[];
    extra: string[];
};

export { type Manifest, type ManifestFile, diffManifest, manifestFor, sha256Hex };
