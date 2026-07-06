// Build the Airbnb Power BI model directly via the powerbi-modeling MCP (empty-capability
// client => no write-confirmation prompt). Same proven approach as work/03.
// Assumes Power BI Desktop is open with the bookings CSV loaded.
const { createClient } = require('./mcp-client');

// Total Payout parses the text Payout column inline (sv-SE imported it as String), so no
// calculated column is needed. Everything else derives from [Total Payout].
const PARSE = `SUMX ( Bookings,
  VAR s = TRIM ( Bookings[Payout] )
  VAR neg = LEFT ( s, 1 ) = "-"
  VAR s2 = IF ( neg, MID ( s, 2, LEN ( s ) ), s )
  VAR dot = FIND ( ".", s2, 1, 0 )
  VAR ip = IF ( dot = 0, s2, LEFT ( s2, dot - 1 ) )
  VAR fp = IF ( dot = 0, "0", MID ( s2, dot + 1, LEN ( s2 ) ) )
  VAR v = VALUE ( ip ) + DIVIDE ( VALUE ( fp ), 10 ^ LEN ( fp ) )
  RETURN IF ( neg, -v, v ) )`;

const DATE_DAX = `ADDCOLUMNS (
  CALENDAR ( DATE ( YEAR ( MIN ( Bookings[CheckIn] ) ), 1, 1 ), DATE ( YEAR ( MAX ( Bookings[CheckIn] ) ), 12, 31 ) ),
  "Year", YEAR ( [Date] ),
  "MonthNo", MONTH ( [Date] ),
  "Month", FORMAT ( [Date], "YYYY-MM" ),
  "MonthName", FORMAT ( [Date], "MMM YYYY" ),
  "Quarter", "Q" & FORMAT ( [Date], "Q" )
)`;

const kr = `#,##0 "kr"`, n0 = `#,##0`, n1 = `0.0`, pct = `0.0%`;
const measures = [
  { Name: 'Total Payout',        TableName: 'Bookings', Expression: PARSE, FormatString: kr, DisplayFolder: '1 Revenue' },
  { Name: 'Realized Payout',     TableName: 'Bookings', Expression: `CALCULATE ( [Total Payout], Bookings[Status] IN { "Completed", "Confirmed" } )`, FormatString: kr, DisplayFolder: '1 Revenue' },
  { Name: 'Pending Pipeline',    TableName: 'Bookings', Expression: `CALCULATE ( [Total Payout], Bookings[Status] = "Pending" )`, FormatString: kr, DisplayFolder: '1 Revenue' },
  { Name: 'Cancellation Impact', TableName: 'Bookings', Expression: `CALCULATE ( [Total Payout], Bookings[Status] = "Cancelled" )`, FormatString: kr, DisplayFolder: '1 Revenue' },
  { Name: 'Payout YTD',          TableName: 'Bookings', Expression: `TOTALYTD ( [Total Payout], 'Date'[Date] )`, FormatString: kr, DisplayFolder: '1 Revenue' },

  { Name: 'Bookings Count',      TableName: 'Bookings', Expression: `COUNTROWS ( Bookings )`, FormatString: n0, DisplayFolder: '2 Volume' },
  { Name: 'Completed Stays',     TableName: 'Bookings', Expression: `CALCULATE ( COUNTROWS ( Bookings ), Bookings[Status] = "Completed" )`, FormatString: n0, DisplayFolder: '2 Volume' },
  { Name: 'Active Bookings',     TableName: 'Bookings', Expression: `CALCULATE ( COUNTROWS ( Bookings ), Bookings[Status] IN { "Confirmed", "Pending" } )`, FormatString: n0, DisplayFolder: '2 Volume' },
  { Name: 'Cancelled Bookings',  TableName: 'Bookings', Expression: `CALCULATE ( COUNTROWS ( Bookings ), Bookings[Status] = "Cancelled" )`, FormatString: n0, DisplayFolder: '2 Volume' },
  { Name: 'Cancellation Rate %', TableName: 'Bookings', Expression: `DIVIDE ( [Cancelled Bookings], [Bookings Count] )`, FormatString: pct, DisplayFolder: '2 Volume' },

  { Name: 'Nights Booked',       TableName: 'Bookings', Expression: `CALCULATE ( SUM ( Bookings[Nights] ), Bookings[Status] IN { "Completed", "Confirmed" } )`, FormatString: n0, DisplayFolder: '3 Occupancy & Yield' },
  { Name: 'Days In Period',      TableName: 'Bookings', Expression: `COUNTROWS ( 'Date' )`, FormatString: n0, DisplayFolder: '3 Occupancy & Yield' },
  { Name: 'Occupancy %',         TableName: 'Bookings', Expression: `DIVIDE ( [Nights Booked], [Days In Period] )`, FormatString: pct, DisplayFolder: '3 Occupancy & Yield' },
  { Name: 'Avg Length of Stay',  TableName: 'Bookings', Expression: `AVERAGEX ( FILTER ( Bookings, Bookings[Status] IN { "Completed", "Confirmed" } ), Bookings[Nights] )`, FormatString: n1, DisplayFolder: '3 Occupancy & Yield' },
  { Name: 'Avg Nightly',         TableName: 'Bookings', Expression: `DIVIDE ( [Realized Payout], [Nights Booked] )`, FormatString: kr, DisplayFolder: '3 Occupancy & Yield' },
  { Name: 'RevPAN',              TableName: 'Bookings', Expression: `DIVIDE ( [Realized Payout], [Days In Period] )`, FormatString: kr, DisplayFolder: '3 Occupancy & Yield' },

  { Name: 'Unique Guests',       TableName: 'Bookings', Expression: `DISTINCTCOUNT ( Bookings[Guest] )`, FormatString: n0, DisplayFolder: '4 Guests' },
  { Name: 'Repeat Guests',       TableName: 'Bookings', Expression: `COUNTROWS ( FILTER ( VALUES ( Bookings[Guest] ), CALCULATE ( COUNTROWS ( Bookings ) ) > 1 ) )`, FormatString: n0, DisplayFolder: '4 Guests' },

  { Name: 'Payout PM',           TableName: 'Bookings', Expression: `CALCULATE ( [Total Payout], DATEADD ( 'Date'[Date], -1, MONTH ) )`, FormatString: kr, DisplayFolder: '5 Trend' },
  { Name: 'Payout MoM %',        TableName: 'Bookings', Expression: `DIVIDE ( [Total Payout] - [Payout PM], [Payout PM] )`, FormatString: pct, DisplayFolder: '5 Trend' },
  { Name: 'Payout R3M Avg',      TableName: 'Bookings', Expression: `CALCULATE ( [Total Payout], DATESINPERIOD ( 'Date'[Date], MAX ( 'Date'[Date] ), -3, MONTH ) ) / 3`, FormatString: kr, DisplayFolder: '5 Trend' },
];

(async () => {
  const c = createClient();
  await c.init();

  const inst = JSON.parse(await c.tool('connection_operations', { operation: 'ListLocalInstances' }));
  if (!inst.data || !inst.data.length) { console.log('NO DESKTOP INSTANCE'); process.exit(2); }
  const target = inst.data[0];
  console.log('TARGET:', target.parentWindowTitle, 'port', target.port);

  const conn = JSON.parse(await c.tool('connection_operations', { operation: 'Connect', connectionString: 'Data Source=localhost:' + target.port }));
  console.log('CONNECT:', conn.message || conn.success);

  // Find the fact table by columns, rename to Bookings (non-fatal).
  const tbls = JSON.parse(await c.tool('table_operations', { Operation: 'List' }));
  const fact = (tbls.data || []).find(t => !t.isHidden && t.columnCount >= 7) || {};
  console.log('FACT TABLE NOW:', fact.name);
  if (fact.name && fact.name !== 'Bookings') {
    const rn = await c.tool('table_operations', { Operation: 'Rename', RenameDefinitions: [{ CurrentName: fact.name, NewName: 'Bookings' }] });
    console.log('RENAME:', rn.slice(0, 300));
  }

  // Date calculated table
  const dt = await c.tool('table_operations', { Operation: 'Create', Definitions: [{ Name: 'Date', DaxExpression: DATE_DAX }], Options: { ContinueOnError: false, UseTransaction: true } }, 180000);
  console.log('DATE TABLE:', dt.slice(0, 400));

  const full = await c.tool('model_operations', { Operation: 'RefreshWithXMLA', RefreshType: 'Full' }, 300000);
  console.log('REFRESH FULL:', full.slice(0, 300));

  const mk = await c.tool('table_operations', { Operation: 'MarkAsDateTable', MarkAsDateTableDefinitions: [{ TableName: 'Date', DateColumnName: 'Date' }] });
  console.log('MARK DATE:', mk.slice(0, 300));

  const rel = await c.tool('relationship_operations', { Operation: 'Create', Definitions: [{ FromTable: 'Bookings', FromColumn: 'CheckIn', ToTable: 'Date', ToColumn: 'Date', FromCardinality: 'Many', ToCardinality: 'One' }] });
  console.log('RELATIONSHIP:', rel.slice(0, 300));

  const meas = await c.tool('measure_operations', { Operation: 'Create', Definitions: measures, Options: { ContinueOnError: false, UseTransaction: true } }, 180000);
  console.log('MEASURES:', meas.slice(0, 800));

  const calc = await c.tool('model_operations', { Operation: 'RefreshWithXMLA', RefreshType: 'Calculate' }, 180000);
  console.log('CALC:', calc.slice(0, 200));

  const dax = await c.tool('dax_query_operations', {
    Operation: 'Execute',
    Query: `EVALUATE ROW ( "RealizedPayout", [Realized Payout], "Occupancy", [Occupancy %], "Bookings", [Bookings Count], "AvgNightly", [Avg Nightly], "RevPAN", [RevPAN], "Pending", [Pending Pipeline], "RepeatGuests", [Repeat Guests] )`,
  }, 120000);
  console.log('VALIDATE:', dax.slice(0, 1500));

  c.kill();
  process.exit(0);
})().catch((e) => { console.error('FAIL:', e.message); process.exit(1); });
