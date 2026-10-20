export const RETAIL_LANDING = {
  eyebrow: "Built around the independent retail day",
  title: "Know what sold. See what needs a closer look.",
  description: "Bring daily sales, product demand and stock evidence into one review. Keep your POS, check supported connections, and choose the tools that fit your shop.",
  problems: [
    ["A sales total only tells part of the story.", "Compare equal periods, then inspect the transaction count and basket value behind the change."],
    ["Stock on hand needs context.", "Review recent demand alongside recorded stock, cover and expiry when your plan and source provide that evidence."],
    ["A purchase affects more than inventory.", "Add BookLoQ to compare proposed spending with recorded commitments and a cash floor before you decide."],
  ],
} as const;
export const INDUSTRY_FITS = [
  { id: "retail", label: "Retail", status: "Available by plan", title: "Daily sales to detailed retail review", body: "Start with daily sales summaries and two available integrations on Free. Paid plans add more connections, advanced inventory and deeper receipt analysis. Source coverage determines which results are available.", href: "/solutions/retail", cta: "Explore retail" },
  { id: "restaurants", label: "Restaurants", status: "Workflow in development", title: "Start with recorded operating totals", body: "Daily sales and recorded lot or waste reviews can support parts of your workflow. Recipe costing, ingredient yields and delivery integrations are not available as a complete restaurant system.", href: "/contact", cta: "Discuss restaurant requirements" },
  { id: "cafes", label: "Cafés", status: "Workflow in development", title: "Understand the day before planning the next", body: "Review supported daily sales records. Ingredient conversion, recipes and specialist café workflows still need development. Confirm your records and requirements before choosing a plan.", href: "/contact", cta: "Discuss café requirements" },
  { id: "dealerships", label: "Dealerships", status: "Limited vehicle workspace", title: "Review the vehicles you have recorded", body: "Growth and Pro include manual or CSV vehicle inventory with recorded costs and status. VIN decoding, vehicle history, DMS connections and a completed vehicle sales workflow are not included.", href: "/contact", cta: "Check dealership fit" },
  { id: "multi_location", label: "Multiple locations", status: "Growth and Pro", title: "Keep the location behind the number", body: "Growth supports up to three active locations; Pro supports up to ten and adds advanced comparison. Map each supported source and check permissions before consolidating results.", href: "/pricing", cta: "Compare location capacity" },
] as const;
export const HOME_FAQS = [
  ["What is included in Free?", "Free has no expiry and requires no payment card. It includes one owner, one active location, up to 100 daily records per month through supported CSV or manual entry, two available integrations of your choice, core daily summaries, and 10 basic AI replies per month. Choose two available integrations on Free. Inventory workflows, advanced reporting, exports and BookLoQ require the relevant paid plan."],
  ["Do I have to replace my POS?", "No. Keep your POS and check the Connections directory for the exact supported edition. Lightspeed Retail R-Series and Square are currently listed as available. Authorization, a completed import and reviewed source totals are required before reports use the records."],
  ["How do I get started?", "Verify your email, set up your authenticator, and add your business. Choose Free or an eligible paid subscription, then enter records or connect a supported source and review the import. An incomplete import is not a complete picture of your business."],
  ["How does the paid trial work?", "Your workspace’s first eligible paid subscription starts with a 7-day trial and requires a payment method. It renews monthly unless you cancel in Manage Billing before the first charge shown at checkout. Free is a separate plan, not a timed trial."],
  ["What can Vanteloq AI do?", "Vanteloq AI can explain permitted business context and help you review next steps. Its answers can be incomplete or incorrect, so inspect the source and assumptions. It cannot post entries, make payments or approve business decisions for you. The homepage answers are labelled scripted illustrations."],
  ["Where can I review privacy and account controls?", "Read the Privacy Notice, Data Processing Terms and service-provider list before connecting records. Access depends on your workspace role. The Help page explains account settings and deletion. Optional public-page analytics can be declined without losing access."],
] as const;
export const RETAIL_FAQS = [
  HOME_FAQS[1],
  HOME_FAQS[0],
  ["Which stock tools do I need?", "Starter includes basic inventory. Growth and Pro add deeper lot, expiry and stock analysis where the source records support it. Recorded stock, recent sales, costs and supplier information can all affect the result. Check the plan comparison and your source before upgrading."],
  ["Can I review more than one shop?", "Free and Starter support one active location. Growth supports up to three, and Pro up to ten with advanced comparison. Each source location needs a correct mapping, sufficient records and the appropriate workspace access."],
  ["What does BookLoQ add?", "BookLoQ provides a separate finance workspace for source documents, reviewed books and 13-week cash planning. It costs CAD39 per month as an add-on to a paid Vanteloq plan or CAD59 per month on its own. It is not included in Free, and expected receipts do not count as confirmed purchasing capacity."],
] as const;
