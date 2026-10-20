import { recommendedOverview } from "./dashboard-personalization";
import type { DashboardPreferences } from "./dashboard-preferences";
import { defaultIndustryConfiguration, resolveIndustryTemplate, type IndustryConfiguration, type IndustryId } from "./industry-templates";

export type PersonalLabState = { step: 1 | 2 | 3; configuration: IndustryConfiguration; overview: DashboardPreferences; generation: number };
export type PersonalLabAction = { type: "business"; industry: IndustryId } | { type: "configuration"; configuration: IndustryConfiguration } | { type: "overview"; overview: DashboardPreferences } | { type: "next" } | { type: "back" } | { type: "restart" };

/** Personal rehearsal only. No storage, transport, workspace IDs or source records. */
export function initialPersonalLab(): PersonalLabState {
  return { step: 1, configuration: defaultIndustryConfiguration("retail"), overview: recommendedOverview("retail"), generation: 0 };
}

export function personalLabReducer(state: PersonalLabState, action: PersonalLabAction): PersonalLabState {
  if (action.type === "restart") return { ...initialPersonalLab(), generation: state.generation + 1 };
  if (action.type === "next") return { ...state, step: Math.min(3, state.step + 1) as PersonalLabState["step"] };
  if (action.type === "back") return { ...state, step: Math.max(1, state.step - 1) as PersonalLabState["step"] };
  if (action.type === "overview") return { ...state, overview: action.overview };
  const configuration = action.type === "business" ? defaultIndustryConfiguration(action.industry) : action.configuration;
  const changed = configuration.templateId !== state.configuration.templateId;
  return { ...state, configuration, overview: changed ? recommendedOverview(resolveIndustryTemplate(configuration.templateId).label) : state.overview };
}
