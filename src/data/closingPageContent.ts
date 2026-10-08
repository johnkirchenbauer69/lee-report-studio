import type { ClosingContent } from "../report-engine/closing/closingContent";

// Seeded from selectable source text; no personnel or corporate figures were updated.
export const closingPageContent: ClosingContent[] = [
  {
    "kind": "sections",
    "variant": "methodology",
    "source": "Supplied reference PDF; reproduce source wording. Definitions require business review before revision.",
    "groups": [
      {
        "id": "section-1",
        "heading": "OUR MARKET",
        "items": [
          {
            "id": "item-1-0",
            "term": "Metropolitan Areas Monitored",
            "description": "Chicago, Racine, Kankakee, Michigan City-La Porte",
            "kind": "bullet"
          }
        ]
      },
      {
        "id": "section-2",
        "heading": "INDUSTRIAL BUILDINGS ANALYZED",
        "items": [
          {
            "id": "item-2-0",
            "term": "Logistics",
            "description": "All distribution, warehouse, refrigeration, cold storage, truck terminals, truck repair & service buildings.",
            "kind": "bullet"
          },
          {
            "id": "item-2-1",
            "term": "Manufacturing",
            "description": "All manufacturing & food processing buildings.",
            "kind": "bullet"
          },
          {
            "id": "item-2-2",
            "term": "",
            "description": "* Tracked buildings are 20,000 SF and larger to focus on major industrial assets that impact the broader market.",
            "kind": "footnote"
          }
        ]
      },
      {
        "id": "section-3",
        "heading": "LOGISTICS DATA",
        "items": [
          {
            "id": "item-3-0",
            "term": "Logistics Managers Index",
            "description": "A widely used, leading economic indicator, which measures the overall health and performance of the logistics and supply chain sector. Specifically measures various components such as inventories, order backlog, transportation, warehousing, and employment.",
            "kind": "bullet"
          },
          {
            "id": "item-3-1",
            "term": "Cass Freight Shipments Index",
            "description": "Measures the total volume of freight shipments within the US economy. It reflects the physical movement of goods and is a key indicator of overall demand for transportation services.",
            "kind": "bullet"
          }
        ]
      },
      {
        "id": "section-4",
        "heading": "MANUFACTURING DATA",
        "items": [
          {
            "id": "item-4-0",
            "term": "Purchasing Managers Index",
            "description": "A leading economic indicator that reflects the health and activity level of the manufacturing and service sectors. It is based on surveys of purchasing managers in various industries and is compiled by institutions like the Institute for Supply Management (ISM) in the U.S. and IHS Markit globally.",
            "kind": "bullet"
          },
          {
            "id": "item-4-1",
            "term": "Industrial Production Index",
            "description": "An economic indicator that measures the real output of the industrial sector of the economy. This sector includes manufacturing, mining, and utilities. Data is seasonally adjusted to spot real shifts in behavior or change of economic activity.",
            "kind": "bullet"
          }
        ]
      },
      {
        "id": "section-5",
        "heading": "GOVERNMENT DATA",
        "items": [
          {
            "id": "item-5-0",
            "term": "Real Gross Domestic Product",
            "description": "Provided by the US Bureau of Economic Analysis and measures the inflation adjusted, GDP for the respective industry, i.e., Transportation and Warehousing: NAICS 48-49 or for Manufacturing: NAICS 31-33",
            "kind": "bullet"
          },
          {
            "id": "item-5-1",
            "term": "Real Wage Growth",
            "description": "Provided by US Bureau of Labor & Statistics and measures the inflation adjusted, average hourly earnings of all employees for the respective industry i.e., Transportation and Warehousing: NAICS 48-49 or for Manufacturing: NAICS 31-33",
            "kind": "bullet"
          },
          {
            "id": "item-5-2",
            "term": "Producers Price Index",
            "description": "Provided by the US Bureau of Labor & Statistics and measures the PPI for the respective industry i.e., Transportation and Warehousing: NAICS 48-49 or for Manufacturing: NAICS 31- 33",
            "kind": "bullet"
          },
          {
            "id": "item-5-3",
            "term": "Unemployment Rate",
            "description": "Provided by the US Bureau of Labor & Statistics and measures the change in unemployment filings (U3) for the respective industry i.e., Transportation and Warehousing: NAICS 48-49 or for Manufacturing: NAICS 31-33",
            "kind": "bullet"
          },
          {
            "id": "item-5-4",
            "term": "",
            "description": "* All Government Data is smoothed for each full year (when available) and YTD for current year, to reduce short- term volatility and to highlight long-term trends.",
            "kind": "footnote"
          },
          {
            "id": "item-5-5",
            "term": "",
            "description": "** Rate of change is calculated by ((Most Recent Year Value - Prior Year Value) / Prior Year Value) x 100",
            "kind": "footnote"
          }
        ]
      }
    ]
  },
  {
    "kind": "sections",
    "variant": "definitions",
    "source": "Supplied reference PDF; reproduce source wording. Definitions require business review before revision.",
    "groups": [
      {
        "id": "section-1",
        "heading": "Net Absorption, Vacancy & Availability - Measures overall market supply & demand.",
        "items": [
          {
            "id": "item-1-0",
            "term": "Direct Net Absorption",
            "description": "Measures the total square feet occupied (Move-Ins) less the total space vacated (Move-Outs) for Direct Space in existing buildings over a given period.",
            "kind": "bullet"
          },
          {
            "id": "item-1-1",
            "term": "Sublet Net Absorption",
            "description": "Measures the total square feet occupied (Move-Ins) less the total space vacated (Move-Outs) for Sublet Space in existing buildings over a given period of time.",
            "kind": "bullet"
          },
          {
            "id": "item-1-2",
            "term": "Availability Rate",
            "description": "Measures the proportion of space available for occupancy at a given time. It is calculated as the total available space (SF) divided by the total RBA (SF).",
            "kind": "bullet"
          },
          {
            "id": "item-1-3",
            "term": "Vacancy Rate",
            "description": "Measures the proportion of unoccupied space relative to the total building area, calculated as total vacant space (SF) divided by the total RBA (SF).",
            "kind": "bullet"
          }
        ]
      },
      {
        "id": "section-2",
        "heading": "Net Absorption of Net Deliveries - Measures demand for new supply.",
        "items": [
          {
            "id": "item-2-0",
            "term": "Net Delivered Supply",
            "description": "Measures the new supply (SF) added to the market, minus any demolished / redeveloped supply (SF).",
            "kind": "bullet"
          },
          {
            "id": "item-2-1",
            "term": "Net Absorption of New Supply",
            "description": "Measures the total square feet occupied (Move-Ins), minus space vacated (Move-Outs) over a given period for newly delivered buildings.",
            "kind": "bullet"
          }
        ]
      },
      {
        "id": "section-3",
        "heading": "Available Supply & Market Share of Total Inventory - Measures supply & demand by property class.",
        "items": [
          {
            "id": "item-3-0",
            "term": "Available Supply",
            "description": "Measures the total available space (SF) for lease as a percentage of total inventory (SF) per property class (A, B, C).",
            "kind": "bullet"
          },
          {
            "id": "item-3-1",
            "term": "Market Share of Total Inventory",
            "description": "Measures the proportion of total inventory (SF) per property class (A, B, C) relative to the sum of total inventory (SF) across all property classes.",
            "kind": "bullet"
          }
        ]
      },
      {
        "id": "section-4",
        "heading": "Property Classification - Weighted appropriately across the following metrics.",
        "items": [
          {
            "id": "item-4-0",
            "term": "Class A",
            "description": "Buildings constructed or renovated in 2004 or later, with a rentable building area (RBA) of 250,000 SF or more, and a clear height of 30 feet or greater, representing the 75th to 100th percentile of all buildings. These buildings are typically modern, feature high-end construction standards, and are designed to meet the needs of top-tier tenants, such as large distribution centers or logistics hubs.",
            "kind": "bullet"
          },
          {
            "id": "item-4-1",
            "term": "Class B",
            "description": "Buildings constructed or renovated between 1983 and 2001, with a rentable building area (RBA) between 100,000 SF and 250,000 SF, and a clear height of 25-30 feet, representing the 50th percentile of all buildings. These buildings typically offer adequate functionality and may attract tenants seeking more cost-effective space compared to Class A properties.",
            "kind": "bullet"
          },
          {
            "id": "item-4-2",
            "term": "Class C",
            "description": "Buildings constructed or renovated between 1950 and 1997, with a rentable building area (RBA) between 20,000 SF and 100,000 SF, and a clear height of less than 25 feet, representing the 0th to 25th percentile of all buildings. These properties are often older, with fewer modern features, and may require updates to meet current industrial or logistical standards, though they may serve smaller tenants or specific local needs.",
            "kind": "bullet"
          }
        ]
      },
      {
        "id": "section-5",
        "heading": "Sales Volume (SF) as (%) of Total Inventory - Measures overall market supply & demand.",
        "items": [
          {
            "id": "item-5-0",
            "term": "Sales (SF)",
            "description": "Total RBA (SF) sold per period.",
            "kind": "bullet"
          },
          {
            "id": "item-5-1",
            "term": "Total Inventory",
            "description": "Total existing RBA (SF) per period.",
            "kind": "bullet"
          },
          {
            "id": "item-5-2",
            "term": "Sales Volume (SF) as (%) of Total Inventory",
            "description": "Measures the proportion of total RBA (SF) sold relative to total existing RBA (SF) over a given period. Logistics:  All distribution, warehouse, refrigeration, cold storage, truck terminals, truck repair & service buildings.",
            "kind": "bullet"
          },
          {
            "id": "item-5-3",
            "term": "Manufacturing",
            "description": "All manufacturing & food processing buildings.",
            "kind": "bullet"
          }
        ]
      }
    ]
  },
  {
    "kind": "contacts",
    "source": "Reference PDF roster; editorial verification required before publication.",
    "departments": [
      {
        "id": "industrial",
        "heading": "INDUSTRIAL SPECIALISTS",
        "columns": 4
      },
      {
        "id": "office",
        "heading": "OFFICE SPECIALISTS",
        "columns": 4
      },
      {
        "id": "healthcare",
        "heading": "HEALTHCARE SPECIALISTS",
        "columns": 3
      },
      {
        "id": "retail",
        "heading": "RETAIL SPECIALIST",
        "columns": 1
      },
      {
        "id": "research",
        "heading": "RESEARCH SPECIALISTS",
        "columns": 2
      },
      {
        "id": "management",
        "heading": "PROPERTY MANAGEMENT",
        "columns": 2
      }
    ],
    "contacts": [
      {
        "id": "contact-1",
        "name": "Dustin Albers",
        "title": "Senior Vice President",
        "email": "dalbers@lee-associates.com",
        "department": "industrial",
        "displayOrder": 0,
        "isActive": true
      },
      {
        "id": "contact-2",
        "name": "Matt Androwich",
        "title": "Vice President",
        "email": "mmandrowich@lee-associates.com",
        "department": "industrial",
        "displayOrder": 1,
        "isActive": true
      },
      {
        "id": "contact-3",
        "name": "Michael Androwich, Jr.",
        "title": "Principal",
        "email": "mjandrowich@lee-associates.com",
        "department": "industrial",
        "displayOrder": 2,
        "isActive": true
      },
      {
        "id": "contact-4",
        "name": "Rick Anesi",
        "title": "Senior Vice President",
        "email": "ranesi@lee-associates.com",
        "department": "industrial",
        "displayOrder": 3,
        "isActive": true
      },
      {
        "id": "contact-5",
        "name": "George Aranowski",
        "title": "Associate",
        "email": "garanowski@lee-associates.com",
        "department": "industrial",
        "displayOrder": 4,
        "isActive": true
      },
      {
        "id": "contact-6",
        "name": "Sean Austin",
        "title": "Principal",
        "email": "saustin@lee-associates.com",
        "department": "industrial",
        "displayOrder": 5,
        "isActive": true
      },
      {
        "id": "contact-7",
        "name": "Andrew Block",
        "title": "Principal",
        "email": "ablock@lee-associates.com",
        "department": "industrial",
        "displayOrder": 6,
        "isActive": true
      },
      {
        "id": "contact-8",
        "name": "Tom Boyle, SIOR",
        "title": "Principal",
        "email": "tomboyle@lee-associates.com",
        "department": "industrial",
        "displayOrder": 7,
        "isActive": true
      },
      {
        "id": "contact-9",
        "name": "John Cassidy, SIOR",
        "title": "Principal",
        "email": "jcassidy@lee-associates.com",
        "department": "industrial",
        "displayOrder": 8,
        "isActive": true
      },
      {
        "id": "contact-10",
        "name": "Thomas Condon, SIOR",
        "title": "Principal",
        "email": "tcondon@lee-associates.com",
        "department": "industrial",
        "displayOrder": 9,
        "isActive": true
      },
      {
        "id": "contact-11",
        "name": "Caroline Dell",
        "title": "Marketing / Vice President",
        "email": "cdell@lee-associates.com",
        "department": "industrial",
        "displayOrder": 10,
        "isActive": true
      },
      {
        "id": "contact-12",
        "name": "Ryan Earley",
        "title": "Principal",
        "email": "rearley@lee-associates.com",
        "department": "industrial",
        "displayOrder": 11,
        "isActive": true
      },
      {
        "id": "contact-13",
        "name": "Nick Eboli",
        "title": "Principal",
        "email": "neboli@lee-associates.com",
        "department": "industrial",
        "displayOrder": 12,
        "isActive": true
      },
      {
        "id": "contact-14",
        "name": "Jay Farnam",
        "title": "Principal",
        "email": "jfarnam@lee-associates.com",
        "department": "industrial",
        "displayOrder": 13,
        "isActive": true
      },
      {
        "id": "contact-15",
        "name": "Marco Federow",
        "title": "Senior Associate",
        "email": "mfederow@lee-associates.com",
        "department": "industrial",
        "displayOrder": 14,
        "isActive": true
      },
      {
        "id": "contact-16",
        "name": "Kenneth Franzese, SIOR",
        "title": "Principal",
        "email": "kfranzese@lee-associates.com",
        "department": "industrial",
        "displayOrder": 15,
        "isActive": true
      },
      {
        "id": "contact-17",
        "name": "Jeffrey Galante, SIOR",
        "title": "Principal",
        "email": "jgalante@lee-associates.com",
        "department": "industrial",
        "displayOrder": 16,
        "isActive": true
      },
      {
        "id": "contact-18",
        "name": "Terry Grapenthin",
        "title": "Principal",
        "email": "tgrape@lee-associates.com",
        "department": "industrial",
        "displayOrder": 17,
        "isActive": true
      },
      {
        "id": "contact-19",
        "name": "Frank Griffin",
        "title": "Principal",
        "email": "fgriffin@lee-associates.com",
        "department": "industrial",
        "displayOrder": 18,
        "isActive": true
      },
      {
        "id": "contact-20",
        "name": "Todd Hendricks",
        "title": "Senior Vice President",
        "email": "thendricks@lee-associates.com",
        "department": "industrial",
        "displayOrder": 19,
        "isActive": true
      },
      {
        "id": "contact-21",
        "name": "Jeffrey Janda, SIOR",
        "title": "Principal",
        "email": "jjanda@lee-associates.com",
        "department": "industrial",
        "displayOrder": 20,
        "isActive": true
      },
      {
        "id": "contact-22",
        "name": "Sam Lepore",
        "title": "Vice President",
        "email": "slepore@lee-associates.com",
        "department": "industrial",
        "displayOrder": 21,
        "isActive": true
      },
      {
        "id": "contact-23",
        "name": "Eric Luhrsen",
        "title": "Vice President",
        "email": "eluhrsen@lee-associates.com",
        "department": "industrial",
        "displayOrder": 22,
        "isActive": true
      },
      {
        "id": "contact-24",
        "name": "Dylan Maher",
        "title": "Senior Vice President",
        "email": "dmaher@lee-associates.com",
        "department": "industrial",
        "displayOrder": 23,
        "isActive": true
      },
      {
        "id": "contact-25",
        "name": "Walter Murphy",
        "title": "Principal",
        "email": "wmurphy@lee-associates.com",
        "department": "industrial",
        "displayOrder": 24,
        "isActive": true
      },
      {
        "id": "contact-26",
        "name": "Christopher Nelson",
        "title": "Principal",
        "email": "cnelson@lee-associates.com",
        "department": "industrial",
        "displayOrder": 25,
        "isActive": true
      },
      {
        "id": "contact-27",
        "name": "Michael O’Leary",
        "title": "Principal",
        "email": "moleary@lee-associates.com",
        "department": "industrial",
        "displayOrder": 26,
        "isActive": true
      },
      {
        "id": "contact-28",
        "name": "Michael Plumb",
        "title": "Principal",
        "email": "mplumb@lee-associates.com",
        "department": "industrial",
        "displayOrder": 27,
        "isActive": true
      },
      {
        "id": "contact-29",
        "name": "Jeffrey Provenza",
        "title": "Principal",
        "email": "jprovenza@lee-associates.com",
        "department": "industrial",
        "displayOrder": 28,
        "isActive": true
      },
      {
        "id": "contact-30",
        "name": "John Sharpe, SIOR",
        "title": "Principal",
        "email": "jsharpe@lee-associates.com",
        "department": "industrial",
        "displayOrder": 29,
        "isActive": true
      },
      {
        "id": "contact-31",
        "name": "Brad Simousek",
        "title": "Senior Vice President",
        "email": "bsimousek@lee-associates.com",
        "department": "industrial",
        "displayOrder": 30,
        "isActive": true
      },
      {
        "id": "contact-32",
        "name": "Colin Sons",
        "title": "Associate",
        "email": "csons@lee-associates.com",
        "department": "industrial",
        "displayOrder": 31,
        "isActive": true
      },
      {
        "id": "contact-33",
        "name": "Peter Spear",
        "title": "Senior Associate",
        "email": "pspear@lee-associates.com",
        "department": "industrial",
        "displayOrder": 32,
        "isActive": true
      },
      {
        "id": "contact-34",
        "name": "Brian Vanosky",
        "title": "Principal",
        "email": "bvanosky@lee-associates.com",
        "department": "industrial",
        "displayOrder": 33,
        "isActive": true
      },
      {
        "id": "contact-35",
        "name": "Michael Adams",
        "title": "Senior Vice President",
        "email": "madams@lee-associates.com",
        "department": "office",
        "displayOrder": 34,
        "isActive": true
      },
      {
        "id": "contact-36",
        "name": "Grant Bollman",
        "title": "Vice President",
        "email": "gbollman@lee-associates.com",
        "department": "office",
        "displayOrder": 35,
        "isActive": true
      },
      {
        "id": "contact-37",
        "name": "Carole Caveney",
        "title": "Senior Vice President",
        "email": "ccaveney@lee-associates.com",
        "department": "office",
        "displayOrder": 36,
        "isActive": true
      },
      {
        "id": "contact-38",
        "name": "Tony Russo",
        "title": "Senior Vice President",
        "email": "trusso@lee-associates.com",
        "department": "office",
        "displayOrder": 37,
        "isActive": true
      },
      {
        "id": "contact-39",
        "name": "Peter Cangialosi",
        "title": "Principal",
        "email": "pcangialosi@lee-associates.com",
        "department": "healthcare",
        "displayOrder": 38,
        "isActive": true
      },
      {
        "id": "contact-40",
        "name": "Doug Pauly",
        "title": "Principal",
        "email": "dpauly@lee-associates.com",
        "department": "healthcare",
        "displayOrder": 39,
        "isActive": true
      },
      {
        "id": "contact-41",
        "name": "Austin York",
        "title": "Associate",
        "email": "ayork@lee-associates.com",
        "department": "healthcare",
        "displayOrder": 40,
        "isActive": true
      },
      {
        "id": "contact-42",
        "name": "Mike Petrik",
        "title": "Senior Associate",
        "email": "mpetrik@lee-associates.com",
        "department": "retail",
        "displayOrder": 41,
        "isActive": true
      },
      {
        "id": "contact-43",
        "name": "Brandon Pappas",
        "title": "VP of Data Analytics",
        "email": "bpappas@lee-associates.com",
        "department": "research",
        "displayOrder": 42,
        "isActive": true
      },
      {
        "id": "contact-44",
        "name": "Eric Lopez",
        "title": "Research Coordinator",
        "email": "ericlopez@lee-associates.com",
        "department": "research",
        "displayOrder": 43,
        "isActive": true
      },
      {
        "id": "contact-45",
        "name": "Ryan Freed",
        "title": "Executive Vice President",
        "email": "rfreed@lee-associates.com",
        "department": "management",
        "displayOrder": 44,
        "isActive": true
      }
    ]
  },
  {
    "kind": "company",
    "source": "Reference PDF corporate statistics and office timeline; periodic editorial verification required.",
    "heading": "WHO WE ARE...",
    "subheading": "THE LEE ADVANTAGE",
    "paragraphs": [
      "With over 75+ offices across the US and Canada, the Lee & Associates group of independently owned and operated companies is the largest regional commercial real estate services provider in the United States.",
      "Each Lee & Associates group office represents a broad array of regional, national and international clients, from individual investors and small businesses, to large corporations and institutions.",
      "Lee & Associates clients enjoy a comprehensive range of specialized commercial real estate services including industrial, office and retail property sales and leasing, real estate investment consulting, real estate financing, property acquisition and disposition, tenant representation and relocation, property and portfolio evaluation and market research.",
      "We are creative strategists who provide value and custom solutions, enabling our clients to make profitable decisions."
    ],
    "emphasis": "Lee & Associates is the largest broker-owned commercial real estate firm in North America, and one of the fastest growing!",
    "growthHeading": "EXPLOSIVE GROWTH",
    "growthCaption": "LOCAL EXPERTISE. INTERNATIONAL REACH. WORLD CLASS.",
    "statistics": [
      {
        "id": "brokered",
        "value": "$2+",
        "label": "BILLION",
        "description": "IN BROKERED SALE &\nLEASE SF OVER 5 YEARS"
      },
      {
        "id": "volume",
        "value": "$120+",
        "label": "BILLION",
        "description": "IN TRANSACTION\nVOLUME OVER 5 YEARS"
      },
      {
        "id": "professionals",
        "value": "1,750",
        "label": "PROFESSIONALS",
        "description": "AND GROWING\nINTERNATIONALLY"
      }
    ],
    "openings": [
      {
        "id": "office-1",
        "year": 2025,
        "market": "New Orleans, LA",
        "displayOrder": 0
      },
      {
        "id": "office-2",
        "year": 2025,
        "market": "Las Vegas, NV",
        "displayOrder": 1
      },
      {
        "id": "office-3",
        "year": 2024,
        "market": "Austin, TX",
        "displayOrder": 2
      },
      {
        "id": "office-4",
        "year": 2024,
        "market": "Charlotte, NC",
        "displayOrder": 3
      },
      {
        "id": "office-5",
        "year": 2023,
        "market": "Tampa Bay, FL",
        "displayOrder": 4
      },
      {
        "id": "office-6",
        "year": 2023,
        "market": "Western Pennsylvania",
        "displayOrder": 5
      },
      {
        "id": "office-7",
        "year": 2023,
        "market": "Bakersfield, CA",
        "displayOrder": 6
      },
      {
        "id": "office-8",
        "year": 2023,
        "market": "Baton Rouge, LA",
        "displayOrder": 7
      },
      {
        "id": "office-9",
        "year": 2022,
        "market": "Omaha, NE",
        "displayOrder": 8
      },
      {
        "id": "office-10",
        "year": 2022,
        "market": "San Francisco, CA",
        "displayOrder": 9
      },
      {
        "id": "office-11",
        "year": 2022,
        "market": "Calgary, AB Canada",
        "displayOrder": 10
      },
      {
        "id": "office-12",
        "year": 2021,
        "market": "Nashville, TN",
        "displayOrder": 11
      },
      {
        "id": "office-13",
        "year": 2020,
        "market": "Naples, FL",
        "displayOrder": 12
      },
      {
        "id": "office-14",
        "year": 2020,
        "market": "Boston, MA",
        "displayOrder": 13
      },
      {
        "id": "office-15",
        "year": 2020,
        "market": "Washington, DC",
        "displayOrder": 14
      },
      {
        "id": "office-16",
        "year": 2019,
        "market": "Toronto, ON Canada",
        "displayOrder": 15
      },
      {
        "id": "office-17",
        "year": 2018,
        "market": "Cincinnati, OH",
        "displayOrder": 16
      },
      {
        "id": "office-18",
        "year": 2018,
        "market": "Raleigh, NC",
        "displayOrder": 17
      },
      {
        "id": "office-19",
        "year": 2018,
        "market": "Miami, FL",
        "displayOrder": 18
      },
      {
        "id": "office-20",
        "year": 2016,
        "market": "Seattle, WA",
        "displayOrder": 19
      },
      {
        "id": "office-21",
        "year": 2016,
        "market": "Walnut Creek",
        "displayOrder": 20
      },
      {
        "id": "office-22",
        "year": 2016,
        "market": "Vancouver, BC Canada",
        "displayOrder": 21
      },
      {
        "id": "office-23",
        "year": 2016,
        "market": "Twin Cities, MN",
        "displayOrder": 22
      },
      {
        "id": "office-24",
        "year": 2016,
        "market": "Pasadena, CA",
        "displayOrder": 23
      },
      {
        "id": "office-25",
        "year": 2015,
        "market": "Eastern Pennsylvania",
        "displayOrder": 24
      },
      {
        "id": "office-26",
        "year": 2015,
        "market": "Columbus, OH",
        "displayOrder": 25
      },
      {
        "id": "office-27",
        "year": 2015,
        "market": "Houston, TX",
        "displayOrder": 26
      },
      {
        "id": "office-28",
        "year": 2014,
        "market": "Denver, CO",
        "displayOrder": 27
      },
      {
        "id": "office-29",
        "year": 2014,
        "market": "Cleveland, OH",
        "displayOrder": 28
      },
      {
        "id": "office-30",
        "year": 2013,
        "market": "Long Island-Queens, NY",
        "displayOrder": 29
      },
      {
        "id": "office-31",
        "year": 2013,
        "market": "Chesapeake Area , MD",
        "displayOrder": 30
      },
      {
        "id": "office-32",
        "year": 2012,
        "market": "Edison, NJ",
        "displayOrder": 31
      },
      {
        "id": "office-33",
        "year": 2012,
        "market": "Orlando, FL",
        "displayOrder": 32
      },
      {
        "id": "office-34",
        "year": 2012,
        "market": "Charleston, SC",
        "displayOrder": 33
      },
      {
        "id": "office-35",
        "year": 2011,
        "market": "Fort Myers, FL",
        "displayOrder": 34
      },
      {
        "id": "office-36",
        "year": 2011,
        "market": "Manhattan, NY",
        "displayOrder": 35
      },
      {
        "id": "office-37",
        "year": 2011,
        "market": "Greenville, SC",
        "displayOrder": 36
      },
      {
        "id": "office-38",
        "year": 2010,
        "market": "Atlanta, GA",
        "displayOrder": 37
      },
      {
        "id": "office-39",
        "year": 2010,
        "market": "Greenwood, IN",
        "displayOrder": 38
      },
      {
        "id": "office-40",
        "year": 2010,
        "market": "Indianapolis, IN",
        "displayOrder": 39
      },
      {
        "id": "office-41",
        "year": 2009,
        "market": "Long Beach, CA",
        "displayOrder": 40
      },
      {
        "id": "office-42",
        "year": 2008,
        "market": "Boise, ID",
        "displayOrder": 41
      },
      {
        "id": "office-43",
        "year": 2008,
        "market": "ISG, LA, CA",
        "displayOrder": 42
      },
      {
        "id": "office-44",
        "year": 2008,
        "market": "Palm Desert, CA",
        "displayOrder": 43
      },
      {
        "id": "office-45",
        "year": 2008,
        "market": "Santa Barbara, CA",
        "displayOrder": 44
      },
      {
        "id": "office-46",
        "year": 2006,
        "market": "Antelope Valley, CA",
        "displayOrder": 45
      },
      {
        "id": "office-47",
        "year": 2006,
        "market": "Dallas, TX",
        "displayOrder": 46
      },
      {
        "id": "office-48",
        "year": 2006,
        "market": "Madison, WI",
        "displayOrder": 47
      },
      {
        "id": "office-49",
        "year": 2006,
        "market": "Oakland, CA",
        "displayOrder": 48
      },
      {
        "id": "office-50",
        "year": 2006,
        "market": "Reno, NV",
        "displayOrder": 49
      },
      {
        "id": "office-51",
        "year": 2006,
        "market": "San Diego - UTC, CA",
        "displayOrder": 50
      },
      {
        "id": "office-52",
        "year": 2006,
        "market": "Ventura, CA",
        "displayOrder": 51
      },
      {
        "id": "office-53",
        "year": 2006,
        "market": "San Luis Obispo, CA",
        "displayOrder": 52
      },
      {
        "id": "office-54",
        "year": 2005,
        "market": "Southfield, MI",
        "displayOrder": 53
      },
      {
        "id": "office-55",
        "year": 2005,
        "market": "Los Olivos, CA",
        "displayOrder": 54
      },
      {
        "id": "office-56",
        "year": 2004,
        "market": "Calabasas, CA",
        "displayOrder": 55
      },
      {
        "id": "office-57",
        "year": 2004,
        "market": "St. Louis, MO",
        "displayOrder": 56
      },
      {
        "id": "office-58",
        "year": 2002,
        "market": "Chicago, IL",
        "displayOrder": 57
      },
      {
        "id": "office-59",
        "year": 2001,
        "market": "Victorville, CA",
        "displayOrder": 58
      },
      {
        "id": "office-60",
        "year": 1999,
        "market": "Temecula Valley, CA",
        "displayOrder": 59
      },
      {
        "id": "office-61",
        "year": 1996,
        "market": "Central LA, CA",
        "displayOrder": 60
      },
      {
        "id": "office-62",
        "year": 1994,
        "market": "Sherman Oaks, CA",
        "displayOrder": 61
      },
      {
        "id": "office-63",
        "year": 1994,
        "market": "West LA, CA",
        "displayOrder": 62
      },
      {
        "id": "office-64",
        "year": 1993,
        "market": "Pleasanton, CA",
        "displayOrder": 63
      },
      {
        "id": "office-65",
        "year": 1993,
        "market": "Stockton, CA",
        "displayOrder": 64
      },
      {
        "id": "office-66",
        "year": 1991,
        "market": "Phoenix, AZ",
        "displayOrder": 65
      },
      {
        "id": "office-67",
        "year": 1990,
        "market": "Carlsbad, CA",
        "displayOrder": 66
      },
      {
        "id": "office-68",
        "year": 1990,
        "market": "Industry, CA",
        "displayOrder": 67
      },
      {
        "id": "office-69",
        "year": 1989,
        "market": "LA - Long Beach, CA",
        "displayOrder": 68
      },
      {
        "id": "office-70",
        "year": 1989,
        "market": "Riverside, CA",
        "displayOrder": 69
      },
      {
        "id": "office-71",
        "year": 1987,
        "market": "Ontario, CA",
        "displayOrder": 70
      },
      {
        "id": "office-72",
        "year": 1984,
        "market": "Newport Beach, CA",
        "displayOrder": 71
      },
      {
        "id": "office-73",
        "year": 1983,
        "market": "Orange, CA",
        "displayOrder": 72
      },
      {
        "id": "office-74",
        "year": 1979,
        "market": "Irvine, CA",
        "displayOrder": 73
      }
    ],
    "mapAsset": "/report-assets/closing/office-map.png",
    "logoAsset": "/report-assets/closing/corporate-logo.svg"
  }
];
