/** One shared package as declared by a participant (shell or remote). */
export interface SharedEntry {
  /** Package name as shared, e.g. "primeng" or "primeng/autocomplete". */
  name: string;
  /** Version this participant ships/provides, if known. */
  version?: string;
  /** True when `version` was guessed from the range because node_modules was not installed. */
  versionGuessed?: boolean;
  /** Range this participant requires at runtime. `false` = no requirement. */
  requiredVersion?: string | false;
  singleton: boolean;
  strictVersion?: boolean;
  eager?: boolean;
  /** How many entry points were collapsed into this entry (primeng/*, @angular/common/http...). */
  entryPoints?: number;
}

/** A shell or remote taking part in the federation. */
export interface Participant {
  /** Label used in reports (the MF name, or the label given on the CLI). */
  name: string;
  /** Federation name from the manifest (used for duplicate-name detection). */
  federationName?: string;
  /** Global/chunk-loading name, if the manifest exposes it. */
  globalName?: string;
  /** Where it was loaded from (URL or path). */
  source: string;
  /** "manifest" = exact data from mf-manifest.json, "project" = heuristic from package.json. */
  kind: 'manifest' | 'project';
  shared: SharedEntry[];
}

export type Severity = 'error' | 'warn' | 'info';

export type RuleId =
  | 'singleton-unsatisfied'
  | 'major-mismatch'
  | 'duplicate-name'
  | 'exact-pin'
  | 'not-singleton'
  | 'version-drift';

export interface Finding {
  rule: RuleId;
  severity: Severity;
  /** Root package name, e.g. "primeng". Empty for participant-level rules. */
  package: string;
  entryPoints?: number;
  message: string;
  details: string[];
  fix?: string;
  participants: string[];
}

export interface CheckOptions {
  /** Packages that must always be singletons (warned by `not-singleton`). */
  criticalSingletons?: string[];
  /** Rule ids or "rule:package" pairs to ignore. */
  ignore?: string[];
}

export interface CheckResult {
  participants: Participant[];
  packagesCompared: number;
  findings: Finding[];
  summary: Record<Severity, number>;
}
