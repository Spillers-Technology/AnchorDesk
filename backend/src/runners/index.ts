/**
 * Runner factory — returns the ScriptRunner for a device's source.
 *
 * GoF pattern: Factory. Mirrors the provider factory in syncService.
 */

import { ScriptRunner } from './ScriptRunner';
import { TacticalRmmRunner } from './TacticalRmmRunner';
import { NinjaOneRunner } from './NinjaOneRunner';
import { DattoRmmRunner } from './DattoRmmRunner';

export function createScriptRunner(source: string): ScriptRunner {
  switch (source) {
    case 'tactical_rmm':
      return new TacticalRmmRunner();

    case 'ninjaone':
      return new NinjaOneRunner();

    case 'datto_rmm':
      return new DattoRmmRunner();

    // Future: case 'meshcentral': return new MeshCentralRunner();

    default:
      throw new Error(`No script runner for device source "${source}" (scripts require a real RMM)`);
  }
}
