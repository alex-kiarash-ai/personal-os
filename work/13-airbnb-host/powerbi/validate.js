const { createClient } = require('./mcp-client');
(async () => {
  const c = createClient();
  await c.init();
  const inst = JSON.parse(await c.tool('connection_operations', { operation: 'ListLocalInstances' }));
  const port = inst.data[0].port;
  await c.tool('connection_operations', { operation: 'Connect', connectionString: 'Data Source=localhost:' + port });
  const q = `EVALUATE ROW ( "RealizedPayout", [Realized Payout], "PayoutYTD", [Payout YTD], "Occupancy", [Occupancy %], "Bookings", [Bookings Count], "Completed", [Completed Stays], "AvgNightly", [Avg Nightly], "RevPAN", [RevPAN], "Pending", [Pending Pipeline], "RepeatGuests", [Repeat Guests], "AvgStay", [Avg Length of Stay] )`;
  const res = await c.tool('dax_query_operations', { Operation: 'Execute', Query: q }, 120000);
  console.log('RESULT:', res);
  c.kill();
  process.exit(0);
})().catch((e) => { console.error('FAIL:', e.message); process.exit(1); });
