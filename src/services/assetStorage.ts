import type { Asset } from '../types/report';

const fileToDataUrl=(file:File)=>new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=()=>reject(reader.error);reader.readAsDataURL(file)});
export interface AssetStorageService { upload(files:File[]):Promise<Asset[]>; list():Promise<Asset[]>; remove(id:string):Promise<void>; }
const browserAssets=async(files:File[]):Promise<Asset[]>=>Promise.all(files.map(async file=>{const font=/\.(woff2?|ttf|otf)$/i.test(file.name);return{id:crypto.randomUUID(),name:file.name.replace(/\.[^.]+$/,''),type:font?'font':/logo/i.test(file.name)?'logo':'image',mimeType:file.type||'application/octet-stream',source:await fileToDataUrl(file),createdAt:new Date().toISOString(),fontFamily:font?file.name.replace(/\.[^.]+$/,''):undefined,storage:'browser',size:file.size}}));

export const assetStorage:AssetStorageService={
  async upload(files){const body=new FormData();files.forEach(file=>body.append('files',file));try{const response=await fetch('/api/assets',{method:'POST',body});if(!response.ok)throw new Error(`Asset API returned ${response.status}`);return (await response.json() as {assets:Asset[]}).assets}catch(error){console.warn('Asset API unavailable; using browser storage.',error);return browserAssets(files)}},
  async list(){const response=await fetch('/api/assets');if(!response.ok)throw new Error('Assets could not be loaded.');return (await response.json() as {assets:Asset[]}).assets},
  async remove(id){const response=await fetch(`/api/assets/${id}`,{method:'DELETE'});if(!response.ok&&response.status!==404)throw new Error('Asset could not be removed.')},
};
