export const ISO_COUNTRY_CODES =
  "AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW".split(
    " ",
  );

const regionNames = new Intl.DisplayNames(["en"], { type: "region" });
export const COUNTRIES = ISO_COUNTRY_CODES.map((code) => ({
  code,
  name: regionNames.of(code) || code,
})).sort((left, right) => left.name.localeCompare(right.name));

export const REGIONS: Record<
  string,
  readonly { code: string; name: string }[]
> = {
  CA: [
    ["AB", "Alberta"],
    ["BC", "British Columbia"],
    ["MB", "Manitoba"],
    ["NB", "New Brunswick"],
    ["NL", "Newfoundland and Labrador"],
    ["NT", "Northwest Territories"],
    ["NS", "Nova Scotia"],
    ["NU", "Nunavut"],
    ["ON", "Ontario"],
    ["PE", "Prince Edward Island"],
    ["QC", "Quebec"],
    ["SK", "Saskatchewan"],
    ["YT", "Yukon"],
  ].map(([code, name]) => ({ code, name })),
  US: [
    ["AL", "Alabama"],
    ["AK", "Alaska"],
    ["AZ", "Arizona"],
    ["AR", "Arkansas"],
    ["CA", "California"],
    ["CO", "Colorado"],
    ["CT", "Connecticut"],
    ["DE", "Delaware"],
    ["DC", "District of Columbia"],
    ["FL", "Florida"],
    ["GA", "Georgia"],
    ["HI", "Hawaii"],
    ["ID", "Idaho"],
    ["IL", "Illinois"],
    ["IN", "Indiana"],
    ["IA", "Iowa"],
    ["KS", "Kansas"],
    ["KY", "Kentucky"],
    ["LA", "Louisiana"],
    ["ME", "Maine"],
    ["MD", "Maryland"],
    ["MA", "Massachusetts"],
    ["MI", "Michigan"],
    ["MN", "Minnesota"],
    ["MS", "Mississippi"],
    ["MO", "Missouri"],
    ["MT", "Montana"],
    ["NE", "Nebraska"],
    ["NV", "Nevada"],
    ["NH", "New Hampshire"],
    ["NJ", "New Jersey"],
    ["NM", "New Mexico"],
    ["NY", "New York"],
    ["NC", "North Carolina"],
    ["ND", "North Dakota"],
    ["OH", "Ohio"],
    ["OK", "Oklahoma"],
    ["OR", "Oregon"],
    ["PA", "Pennsylvania"],
    ["RI", "Rhode Island"],
    ["SC", "South Carolina"],
    ["SD", "South Dakota"],
    ["TN", "Tennessee"],
    ["TX", "Texas"],
    ["UT", "Utah"],
    ["VT", "Vermont"],
    ["VA", "Virginia"],
    ["WA", "Washington"],
    ["WV", "West Virginia"],
    ["WI", "Wisconsin"],
    ["WY", "Wyoming"],
    ["AS", "American Samoa"],
    ["GU", "Guam"],
    ["MP", "Northern Mariana Islands"],
    ["PR", "Puerto Rico"],
    ["UM", "U.S. Minor Outlying Islands"],
    ["VI", "U.S. Virgin Islands"],
  ].map(([code, name]) => ({ code, name })),
};

export function validPostalCode(countryCode: string, value: string) {
  const normalized = value.trim().toUpperCase();
  if (countryCode === "CA")
    return /^[ABCEGHJ-NPRSTVXY]\d[ABCEGHJ-NPRSTV-Z][ -]?\d[ABCEGHJ-NPRSTV-Z]\d$/.test(
      normalized,
    );
  if (countryCode === "US") return /^\d{5}(?:-\d{4})?$/.test(normalized);
  return (
    normalized.length > 0 &&
    normalized.length <= 20 &&
    !/[\u0000-\u001f\u007f]/.test(normalized)
  );
}

export function formatPostalCode(countryCode: string, value: string) {
  const normalized = value.trim().toUpperCase().replace(/\s+/g, "");
  return countryCode === "CA" && normalized.length === 6
    ? `${normalized.slice(0, 3)} ${normalized.slice(3)}`
    : normalized;
}
