// Synthetic rendering fixtures only; no database or external service is accessed.
const fs = require('node:fs');
const path = require('node:path');
process.chdir(path.resolve(__dirname, '..'));
const { SnLabelsExport } = require('../dist/src/modules/sn-labels/sn-labels.export.js');
const output = path.resolve(process.argv[2] || path.join(__dirname, '../../../outputs/carton-erp-20261012/pdf'));
const data = { model: 'M1', style: '標準', color: '黑', barcode: '', cartonWidth: 60 };
const samples = [
  { file: 'sn-carton-60x75.pdf', kind: 'cartons', box: { id: 'CTN-261012-M1-001', quantity: 32, serials: Array.from({length:32},(_,i)=>`Vendor-a${String(i+1).padStart(5,'0')}`) } },
  { file: 'no-sn-carton-60x45.pdf', kind: 'cartons-no-sn', box: { id: 'CTN-261012-M1-002', quantity: 10, serials: [] } },
  { file: 'existing-long-sn-carton-60x75.pdf', kind: 'cartons', box: { id: 'CTN-261012-M1-003', quantity: 2, serials: ['W'.repeat(100),'Vendor-A02'] } },
];
(async()=>{
  fs.mkdirSync(output,{recursive:true});
  const exporter=new SnLabelsExport();
  for(const sample of samples) {
    const file=path.join(output,sample.file);
    fs.writeFileSync(file,await exporter.pdf(sample.kind,data,[],[sample.box]));
    console.log(JSON.stringify({file,expectedQR:`CARTON:${sample.box.id}`,sizeMm:[60,sample.kind==='cartons-no-sn'?45:75]}));
  }
})().catch(error=>{console.error(error.message);process.exitCode=1});
