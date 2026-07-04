const { createClient } = require('./mcp-client');

const XLSX = 'C:\\Users\\Thinkpad\\Desktop\\personal-os\\work\\03-application-engine\\powerbi\\job-search-pipeline.xlsx';

function mForSheet(sheet, typeTransforms, selectCols) {
  return (
    'let Source = Excel.Workbook(File.Contents("' + XLSX + '"), null, true), ' +
    'Sheet = Source{[Item="' + sheet + '",Kind="Sheet"]}[Data], ' +
    'Promoted = Table.PromoteHeaders(Sheet, [PromoteAllScalars=true]), ' +
    'Selected = Table.SelectColumns(Promoted, {' + selectCols.map((c) => '"' + c + '"').join(', ') + '}), ' +
    'Typed = Table.TransformColumnTypes(Selected, {' + typeTransforms + '}) ' +
    'in Typed'
  );
}

const col = (name, dataType, ordinal) => ({ Name: name, DataType: dataType, IsNullable: true, Ordinal: ordinal });

const tables = [
  {
    Name: 'processed_jobs',
    Mode: 'Import',
    Description: 'All jobs that hit the Stage 3 gate, with pass/needs_review outcome. Source: Job Search Pipeline sheet.',
    MExpression: mForSheet(
      'processed_jobs',
      '{"job_posting_id", Int64.Type}, {"date", type date}, {"company_name", type text}, {"job_title", type text}, {"gate_status", type text}',
      ['job_posting_id', 'date', 'company_name', 'job_title', 'gate_status']
    ),
    Columns: [
      col('job_posting_id', 'Int64', 0),
      col('date', 'DateTime', 1),
      col('company_name', 'String', 2),
      col('job_title', 'String', 3),
      col('gate_status', 'String', 4),
    ],
  },
  {
    Name: 'run_log',
    Mode: 'Import',
    Description: 'Jobs that passed the gate and have rendered CV + cover letter in Drive. status=draft_ready means waiting for Shaheen to submit.',
    MExpression: mForSheet(
      'run_log',
      '{"date", type date}, {"job_posting_id", Int64.Type}, {"company", type text}, {"location", type text}, {"country", type text}, {"fit_score", Int64.Type}, {"interest_score", Int64.Type}, {"rank_score", Int64.Type}, {"total_cost", type number}, {"drive_folder_url", type text}, {"job_url", type text}, {"status", type text}',
      ['date', 'job_posting_id', 'company', 'location', 'country', 'fit_score', 'interest_score', 'rank_score', 'total_cost', 'drive_folder_url', 'job_url', 'status']
    ),
    Columns: [
      col('date', 'DateTime', 0),
      col('job_posting_id', 'Int64', 1),
      col('company', 'String', 2),
      col('location', 'String', 3),
      col('country', 'String', 4),
      col('fit_score', 'Int64', 5),
      col('interest_score', 'Int64', 6),
      col('rank_score', 'Int64', 7),
      col('total_cost', 'Double', 8),
      col('drive_folder_url', 'String', 9),
      col('job_url', 'String', 10),
      col('status', 'String', 11),
    ],
  },
  {
    Name: 'needs_review',
    Mode: 'Import',
    Description: 'Jobs the gate routed to manual review, with scores and gate reasons.',
    MExpression: mForSheet(
      'needs_review',
      '{"date", type date}, {"job_posting_id", Int64.Type}, {"job_title", type text}, {"company_name", type text}, {"job_location", type text}, {"url", type text}, {"fit_score", Int64.Type}, {"interest_score", Int64.Type}, {"rank_score", Int64.Type}, {"reasons", type text}',
      ['date', 'job_posting_id', 'job_title', 'company_name', 'job_location', 'url', 'fit_score', 'interest_score', 'rank_score', 'reasons']
    ),
    Columns: [
      col('date', 'DateTime', 0),
      col('job_posting_id', 'Int64', 1),
      col('job_title', 'String', 2),
      col('company_name', 'String', 3),
      col('job_location', 'String', 4),
      col('url', 'String', 5),
      col('fit_score', 'Int64', 6),
      col('interest_score', 'Int64', 7),
      col('rank_score', 'Int64', 8),
      col('reasons', 'String', 9),
    ],
  },
];

const measures = [
  { Name: 'Jobs Processed', TableName: 'processed_jobs', Expression: 'COUNTROWS(processed_jobs)', FormatString: '#,0' },
  { Name: 'Apps To Review', TableName: 'processed_jobs', Expression: 'CALCULATE(COUNTROWS(processed_jobs), processed_jobs[gate_status] = "needs_review")', FormatString: '#,0', Description: 'Jobs the gate routed to manual review. The pile waiting for Shaheen.' },
  { Name: 'Apps Ready To Apply', TableName: 'processed_jobs', Expression: 'CALCULATE(COUNTROWS(run_log), run_log[status] = "draft_ready")', FormatString: '#,0', Description: 'Drafted applications (CV + cover letter in Drive) waiting for submit.' },
  { Name: 'Pass Rate', TableName: 'processed_jobs', Expression: 'DIVIDE(CALCULATE(COUNTROWS(processed_jobs), processed_jobs[gate_status] = "pass"), COUNTROWS(processed_jobs))', FormatString: '0.0%' },
  { Name: 'Avg Fit (To Review)', TableName: 'needs_review', Expression: 'AVERAGE(needs_review[fit_score])', FormatString: '0.0' },
  { Name: 'Pipeline Cost (USD)', TableName: 'run_log', Expression: 'SUM(run_log[total_cost])', FormatString: '$0.000' },
];

(async () => {
  const c = createClient();
  await c.init();

  const inst = JSON.parse(await c.tool('connection_operations', { operation: 'ListLocalInstances' }));
  if (!inst.success || !inst.data || !inst.data.length) { console.log('NO DESKTOP INSTANCE'); process.exit(2); }
  const target = inst.data[0];
  console.log('TARGET:', target.parentWindowTitle, 'port', target.port);

  const conn = JSON.parse(await c.tool('connection_operations', { operation: 'Connect', connectionString: 'Data Source=localhost:' + target.port }));
  console.log('CONNECT:', conn.success, conn.message);
  if (!conn.success) process.exit(2);

  const created = await c.tool('table_operations', { Operation: 'Create', Definitions: tables, Options: { ContinueOnError: false, UseTransaction: true } }, 180000);
  console.log('CREATE TABLES:', created.slice(0, 1200));

  const refresh = await c.tool('model_operations', { Operation: 'RefreshWithXMLA', RefreshType: 'Full' }, 300000);
  console.log('REFRESH:', refresh.slice(0, 800));

  const meas = await c.tool('measure_operations', { Operation: 'Create', Definitions: measures, Options: { ContinueOnError: false, UseTransaction: true } }, 120000);
  console.log('CREATE MEASURES:', meas.slice(0, 1200));

  const calc = await c.tool('model_operations', { Operation: 'RefreshWithXMLA', RefreshType: 'Calculate' }, 120000);
  console.log('CALC:', calc.slice(0, 400));

  const dax = await c.tool('dax_query_operations', {
    Operation: 'Execute',
    Query: 'EVALUATE ROW("JobsProcessed", [Jobs Processed], "AppsToReview", [Apps To Review], "AppsReadyToApply", [Apps Ready To Apply], "PassRate", [Pass Rate], "PipelineCostUSD", [Pipeline Cost (USD)])',
  }, 120000);
  console.log('VALIDATE:', dax.slice(0, 1500));

  c.kill();
  process.exit(0);
})().catch((e) => { console.error('FAIL:', e.message); process.exit(1); });
