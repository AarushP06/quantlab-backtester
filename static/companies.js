// Shared display names for the saved stock universe: [short name, full name, listing exchange].
const COMPANY_NAMES = {
  AAPL: ["Apple", "Apple Inc.", "NASDAQ"], ABBV: ["AbbVie", "AbbVie Inc.", "NYSE"], ADBE: ["Adobe", "Adobe Inc.", "NASDAQ"],
  AMD: ["AMD", "Advanced Micro Devices", "NASDAQ"], AMZN: ["Amazon", "Amazon.com, Inc.", "NASDAQ"], AVGO: ["Broadcom", "Broadcom Inc.", "NASDAQ"],
  BAC: ["Bank of America", "Bank of America Corp.", "NYSE"], "BRK-B": ["Berkshire Hathaway", "Berkshire Hathaway Inc.", "NYSE"],
  COST: ["Costco", "Costco Wholesale Corp.", "NASDAQ"], CRM: ["Salesforce", "Salesforce, Inc.", "NYSE"], DIS: ["Disney", "The Walt Disney Company", "NYSE"],
  GOOGL: ["Alphabet", "Alphabet Inc.", "NASDAQ"], HD: ["Home Depot", "The Home Depot, Inc.", "NYSE"], JNJ: ["Johnson & Johnson", "Johnson & Johnson", "NYSE"],
  JPM: ["JPMorgan Chase", "JPMorgan Chase & Co.", "NYSE"], KO: ["Coca-Cola", "The Coca-Cola Company", "NYSE"], MA: ["Mastercard", "Mastercard Inc.", "NYSE"],
  MCD: ["McDonald’s", "McDonald’s Corp.", "NYSE"], META: ["Meta Platforms", "Meta Platforms, Inc.", "NASDAQ"], MSFT: ["Microsoft", "Microsoft Corp.", "NASDAQ"],
  NFLX: ["Netflix", "Netflix, Inc.", "NASDAQ"], NVDA: ["NVIDIA", "NVIDIA Corp.", "NASDAQ"], ORCL: ["Oracle", "Oracle Corp.", "NYSE"],
  PEP: ["PepsiCo", "PepsiCo, Inc.", "NASDAQ"], PG: ["Procter & Gamble", "The Procter & Gamble Company", "NYSE"], TSLA: ["Tesla", "Tesla, Inc.", "NASDAQ"],
  UNH: ["UnitedHealth", "UnitedHealth Group Inc.", "NYSE"], V: ["Visa", "Visa Inc.", "NYSE"], WMT: ["Walmart", "Walmart Inc.", "NASDAQ"],
  XOM: ["Exxon Mobil", "Exxon Mobil Corp.", "NYSE"]
};
const shortName = symbol => COMPANY_NAMES[symbol]?.[0] || symbol;
const fullName = symbol => COMPANY_NAMES[symbol]?.[1] || symbol;
const listingExchange = symbol => COMPANY_NAMES[symbol]?.[2] || "US";
