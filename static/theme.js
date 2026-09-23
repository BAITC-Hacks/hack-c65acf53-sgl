/* Apply preference before paint. Map and shell share this theme controller. */
(()=>{
  const key='akim-theme-v1';let theme;
  try{theme=localStorage.getItem(key);}catch(_){}
  if(!['light','dark'].includes(theme))theme=matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';
  const apply=value=>{theme=value==='dark'?'dark':'light';document.documentElement.dataset.theme=theme;document.documentElement.style.colorScheme=theme;document.querySelector('meta[name="theme-color"]')?.setAttribute('content',theme==='dark'?'#172824':'#f7f6f2');};
  apply(theme);
  window.AkimTheme={get:()=>theme,set(value){apply(value);try{localStorage.setItem(key,theme);}catch(_){}window.dispatchEvent(new CustomEvent('themechange',{detail:theme}));}};
})();
