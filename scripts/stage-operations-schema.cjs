// Staging-only deployment helper. No credentials are printed or persisted.
const { execFileSync } = require('node:child_process');
const project = 'moztech-main-db', region = 'asia-east1';
const job = 'erp-ops-schema-0910';
const image = process.argv[2];
const apply = process.argv[3] === '--apply';
if (!/^asia-east1-docker\.pkg\.dev\/moztech-main-db\/cloud-run\/ecom-accounting-backend:ops-[a-f0-9]{8}$/.test(image || '')) throw Error('Unexpected image');
function cloud(args, input) { return execFileSync('gcloud', [...args, '--project='+project, '--region='+region, '--quiet'], {input,encoding:'utf8',maxBuffer:8*1024*1024}); }
const service = JSON.parse(cloud(['run','services','describe','ecom-accounting-backend-after-sales-staging','--format=json']));
const template = service.spec.template;
const env = template.spec.containers[0].env;
if (env.find(x => x.name === 'DB_NAME')?.value !== 'erp_after_sales_staging') throw Error('Refusing non-staging database');
const code = `
require('./scripts/database-url').configureDatabaseUrl();
const {PrismaClient}=require('@prisma/client'); const fs=require('node:fs'); const crypto=require('node:crypto');
const p=new PrismaClient();
(async()=>{
 if(process.env.DB_NAME!=='erp_after_sales_staging')throw Error('wrong_database');
 const db=await p.$queryRawUnsafe('SELECT current_database() AS name'); if(db[0].name!=='erp_after_sales_staging')throw Error('wrong_database');
 const rows=await p.$queryRawUnsafe('SELECT migration_name,checksum,finished_at,rolled_back_at FROM _prisma_migrations');
 const active=rows.filter(r=>!r.rolled_back_at); if(active.some(r=>!r.finished_at))throw Error('unfinished_migration');
 const dirs=fs.readdirSync('prisma/migrations').filter(n=>fs.existsSync('prisma/migrations/'+n+'/migration.sql')).sort();
 for(const r of active){if(!dirs.includes(r.migration_name))throw Error('unknown_applied_migration'); const sum=crypto.createHash('sha256').update(fs.readFileSync('prisma/migrations/'+r.migration_name+'/migration.sql')).digest('hex'); if(sum!==r.checksum)throw Error('migration_checksum_mismatch');}
 const pending=dirs.filter(n=>!active.some(r=>r.migration_name===n));
 console.log(JSON.stringify({database:'erp_after_sales_staging',pending,applied:active.length}));
 if(pending.some(n=>n!=='20260910110000_after_sales_preparation'))throw Error('unexpected_pending_migration');
 await p.$disconnect();
 ${apply ? "if(pending.length)require('node:child_process').execFileSync('node',['scripts/migrate-prod.js'],{stdio:'inherit'});" : ''}
})().catch(async e=>{console.error('SCHEMA_CHECK_FAILED',/^[a-z_]+$/.test(e.message)?e.message:'database_or_migration_error'); await p.$disconnect();process.exitCode=1;});`;
const annotations = {};
for (const name of ['run.googleapis.com/cloudsql-instances','run.googleapis.com/vpc-access-connector','run.googleapis.com/vpc-access-egress']) if (template.metadata.annotations[name]) annotations[name]=template.metadata.annotations[name];
const config = {apiVersion:'run.googleapis.com/v1',kind:'Job',metadata:{name:job},spec:{template:{metadata:{annotations},spec:{taskCount:1,parallelism:1,template:{spec:{serviceAccountName:template.spec.serviceAccountName,timeoutSeconds:'600',maxRetries:0,containers:[{image,env,command:['node'],args:['-e',code],resources:{limits:{cpu:'1000m',memory:'1Gi'}}}]}}}}}};
cloud(['run','jobs','replace','-'],JSON.stringify(config));
console.log(cloud(['run','jobs','execute',job,'--async','--format=value(metadata.name)']).trim());
