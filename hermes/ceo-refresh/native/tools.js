import {runtime} from "../runtime.ts";
export const graph=(resource,params)=>runtime().tools.graph(resource,params);
export const providerFetch=(input,init)=>runtime().tools.request(input,init);
export const googleYoutubeToken=()=>runtime().tools.youtubeToken();
export const creativeRequestRest=(resource,init)=>runtime().tools.rest(resource,init?.body);
