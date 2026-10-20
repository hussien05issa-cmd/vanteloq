import {getRuntimeEnv} from '../../../db/index';
import {servePublicFilm} from '../../../server/public-films';

async function film(request:Request,context:{params:Promise<{film:string}>}){
  const assets=(getRuntimeEnv() as {ASSETS?:{fetch(request:Request):Promise<Response>}}).ASSETS;
  return servePublicFilm(request,(await context.params).film,assets);
}
export const GET=film;
export const HEAD=film;
