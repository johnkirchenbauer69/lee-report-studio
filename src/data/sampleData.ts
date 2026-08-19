export const sampleData = {
  report: {
    title: 'Chicago Industrial Market Report',
    period: '2026 Q2',
    preparedBy: 'Lee & Associates Chicago',
  },
  overall_market: {
    inventory_sf: 1268450000,
    vacancy_rate: 0.054,
    availability_rate: 0.091,
    net_absorption: 3780000,
    leasing_activity_sf: 22800000,
    under_construction_sf: 14200000,
  },
  markets: [
    { name: "O'Hare", inventory_sf: 121400000, vacancy_rate: 0.051, availability_rate: 0.078, net_absorption: 465000 },
    { name: 'I-55', inventory_sf: 118800000, vacancy_rate: 0.046, availability_rate: 0.081, net_absorption: 720000 },
    { name: 'I-80 / Joliet', inventory_sf: 178300000, vacancy_rate: 0.066, availability_rate: 0.112, net_absorption: 1130000 },
    { name: 'I-88', inventory_sf: 98200000, vacancy_rate: 0.061, availability_rate: 0.103, net_absorption: -379000 },
    { name: 'South Cook', inventory_sf: 86400000, vacancy_rate: 0.059, availability_rate: 0.097, net_absorption: 446000 },
  ],
  market: {
    name: "O'Hare",
    inventory_sf: 121400000,
    vacancy_rate: 0.051,
    availability_rate: 0.078,
    net_absorption: 465000,
    top_leases: [
      { tenant: 'Doumak', address: '1000 Example Rd', size_sf: 202759 },
      { tenant: 'Tafco', address: '2200 Commerce Dr', size_sf: 189589 },
      { tenant: 'Example Logistics', address: '3150 Cargo Way', size_sf: 145000 },
    ],
  },
};
