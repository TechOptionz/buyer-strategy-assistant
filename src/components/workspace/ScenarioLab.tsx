"use client";

import { useWs } from "./context";
import { ScenariosView } from "./lab/ScenariosView";
import { SuburbsView } from "./lab/SuburbsView";

/**
 * Scenario Lab tab body (designs 04 Scenario Lab and 05 Suburb Comparison). Each view renders the
 * shared sub-toolbar with the dark "Scenarios | Suburbs" toggle; the view is kept in the URL (?view=).
 */
export function ScenarioLab() {
  const { labView } = useWs();
  return labView === "suburbs" ? <SuburbsView /> : <ScenariosView />;
}
