(function () {
  const rooms = [
    'ACC', 'C&FA', 'CS', 'CIC', 'DIR', 'ENG', 'FIN', 'GR', 'HP', 'HCM', 'HRD',
    'HRM', 'IT', 'L&S', 'MTN', 'MKT', 'MC', 'OS', 'PD', 'PD1', 'PD2', 'PC', 'PE',
    'PUR', 'QA', 'QC', 'RDPP', 'R&D', 'SHE', 'SCM', 'SYS-ENG', 'TSH CENTER', 'WH'
  ];

  function has(room) {
    return rooms.includes(room);
  }

  function fill(select, current = '') {
    select.options.length = 1;
    for (const room of rooms) select.add(new Option(room, room));
    if (current && !has(current)) select.add(new Option(`${current} (ค่าเดิม)`, current));
    select.value = current;
  }

  if (typeof module === 'object' && module.exports) module.exports = { has };
  else window.RoyalRooms = { fill };
})();
