function s(r,t=0,o=1){return r<t?t:r>o?o:r}const f=r=>{const t=Math.round(r*1e3),o=Math.floor(t/65536),n=Math.floor(t/256)-o*256,c=Math.floor(t)-o*65536-n*256;return[o,n,c]};export{s as c,f as t};
