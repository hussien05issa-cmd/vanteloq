# Unified Vanteloq AI
September 13, 2026.

The visible Business analysis / App help switch has been removed. One conversation accepts business questions, financial and analytical concepts, and instructions for using Vanteloq or BookLoQ. Suggestions include both analytical questions and setup help. Replies use the Vanteloq AI identity.

Settings now has an explicit Workspace data switch beside the existing memory and saved-chat controls. Turning it off uses the established server path that excludes workspace evidence. Turning it on uses the same role-, location-, provider- and entitlement-filtered summaries as before. Changing the data setting starts a fresh chat and clears consent, so old business context cannot carry into a request without records. This does not grant additional account permissions.

Both paths share the financial and business playbook: source coverage, equivalent reporting periods, accounting checks, cash scenarios, product/basket analysis, inventory, marketing attribution and risk. General explanations without records are labelled general guidance. The assistant is instructed not to invent values, switch users between chat modes, imply access to raw records or claim it can execute business actions.

The AI notice is versioned as vanteloq-ai-v7-unified. Privacy copy and consent receipts distinguish data-on and data-off requests. Old notice versions are rejected until the current notice is reviewed. Memory remains off by default; enabling it uses up to six recent messages only when evidence and access match.

Validation evidence is recorded in outputs/launch205-unit.log, launch205-flow.log, launch205-typecheck.log, launch205-lint.log and launch205-final-build.log. Desktop and phone screenshots are saved under outputs/design-audit-204/11-unified-ai-desktop.png and 12-unified-ai-mobile.png.

The first live mixed-question check identified overstatements about absent data, an inaccurate gross-margin definition and invented navigation. The follow-up hardens the terminology and route instructions and passes only fixed, allowlisted explanations for known source-consistency and BookLoQ access blocks. It never forwards raw error messages to OpenAI. An empty request does not establish that the account has no records. The regression covers active sync blocking while preserving privacy and tenant boundaries.

The 29-test flow run had 28 passes and one missing-build-chunk failure while a local rebuild replaced dist. Its isolated rerun passed. The additional availability/provider/client suite has 18 passes. These tests validate controls and request wiring, not the correctness of every generated answer.

The final provider configuration uses medium reasoning effort with a bounded 3,200-token output budget to allow checking of financial definitions and product navigation. The same model, single provider, 45-second timeout, data boundaries and disabled provider storage remain. This can take longer than low effort and remains subject to factual review.
