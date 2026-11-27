(() => {
  const listeners = {start:[],move:[],end:[],cancel:[],wheel:[],hide:[],show:[],resize:[]}; let main;
  const pointers = new Map();
  const emit = (type, value) => listeners[type].forEach(fn => fn(value));
  let modal = null;
  // 使用页面内输入框，避免内嵌浏览器不显示原生 prompt 对话框。
  function showModal(options) {
    if (modal) return;
    const previousFocus = document.activeElement;
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;z-index:20;display:flex;align-items:center;justify-content:center;padding:16px;background:#08110cda;font-family:system-ui,"Microsoft YaHei",sans-serif;color:#e4e8d7';
    const form = document.createElement('form');
    form.setAttribute('role', 'dialog');form.setAttribute('aria-modal', 'true');form.setAttribute('aria-labelledby', 'commander-dialog-title');
    form.style.cssText = 'width:480px;max-width:100%;max-height:100%;overflow:auto;padding:24px;background:#1a251e;border:1px solid #b0c881;box-shadow:0 18px 70px #0008;box-sizing:border-box';
    const title = document.createElement('h2');title.id = 'commander-dialog-title';title.textContent = options.title || '提示';title.style.cssText = 'font-size:21px;margin:0 0 20px';
    form.appendChild(title);
    const input = document.createElement('input');
    input.type = 'text';input.setAttribute('aria-label', options.inputLabel || '指挥官名称');input.autocomplete = 'off';
    if(options.numberInput)input.inputMode='numeric';
    input.value = options.content || '';input.placeholder = options.placeholderText || '';
    input.style.cssText = 'display:block;box-sizing:border-box;width:100%;border:1px solid #758b60;border-radius:2px;background:#101813;color:#eef3e2;padding:12px;font:18px system-ui;outline-color:#b0c881';
    const error = document.createElement('p');error.id = 'commander-dialog-error';error.setAttribute('aria-live', 'polite');error.style.cssText = 'font-size:14px;min-height:20px;margin:10px 0 20px;color:#dfaa76';input.setAttribute('aria-describedby',error.id);
    if(options.editable)form.appendChild(input);
    else {const content=document.createElement('p');content.textContent=options.content||'';form.appendChild(content)}
    form.appendChild(error);
    const actions = document.createElement('div');actions.style.cssText = 'display:flex;gap:12px';
    const cancel = document.createElement('button');cancel.type='button';cancel.textContent='取消';
    const confirm = document.createElement('button');confirm.type='submit';confirm.textContent=options.confirmText || (options.editable?'保存名称':'确定');
    for(const button of [cancel,confirm])button.style.cssText='flex:1;min-height:46px;border:1px solid #758b60;border-radius:2px;color:#eef3e2;background:#29372b;font:600 16px system-ui;cursor:pointer';
    confirm.style.background='#546c3c';actions.append(cancel,confirm);form.appendChild(actions);overlay.appendChild(form);document.body.appendChild(overlay);modal=overlay;
    const finish = confirmed => {
      const content=input.value.trim();overlay.remove();modal=null;
      if(previousFocus?.isConnected)previousFocus.focus?.();
      const result={confirm:confirmed,cancel:!confirmed,content};options.success?.(result);options.complete?.(result);
    };
    cancel.addEventListener('click',()=>finish(false));
    form.addEventListener('submit',event=>{
      event.preventDefault();const value=input.value.trim();
      if(options.editable&&options.numberInput&&(!/^\d+$/.test(value)||!Number.isInteger(Number(value))||Number(value)<options.minValue||Number(value)>options.maxValue)){
        error.textContent=`${options.numberLabel||'人数'}必须为 ${options.minValue}—${options.maxValue} 之间的整数。`;input.setAttribute('aria-invalid','true');input.focus();return
      }
      if(options.editable&&options.numberInput&&Number.isFinite(options.maxAvailable)&&Number(value)>options.maxAvailable){
        error.textContent=`未编人员不足：需要 ${Number(value)} 人，当前仅有 ${options.maxAvailable} 人。`;input.setAttribute('aria-invalid','true');input.focus();return
      }
      if(options.editable&&(!value||Array.from(value).length>(options.maxLength||12))){error.textContent=!value?'请输入指挥官名称，不能只填写空格。':`名称最多 ${options.maxLength||12} 个字，请缩短后保存。`;input.setAttribute('aria-invalid','true');input.focus();return}
      finish(true);
    });
    input.addEventListener('input',()=>{error.textContent='';input.removeAttribute('aria-invalid')});
    overlay.addEventListener('keydown',event=>{
      if(event.isComposing&&event.key==='Enter'){event.preventDefault();return}
      if(event.key==='Escape'){event.preventDefault();finish(false)}
      if(event.key==='Tab'){
        const first=options.editable?input:cancel,last=confirm;
        if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus()}
        else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus()}
      }
    });
    if(options.editable){input.focus();input.select()}else confirm.focus();
  }
  const safeAreaProbe=document.createElement('div');
  safeAreaProbe.style.cssText='position:fixed;width:0;height:0;visibility:hidden;pointer-events:none;padding:env(safe-area-inset-top, 0px) env(safe-area-inset-right, 0px) env(safe-area-inset-bottom, 0px) env(safe-area-inset-left, 0px)';
  document.body.append(safeAreaProbe);
  const isFullscreen=()=>!!(document.fullscreenElement||document.webkitFullscreenElement);

  window.wx = {
    createCanvas() {
      const c = document.createElement('canvas');
      if (!main) {
        main = c; document.body.prepend(c);
        const point = e => ({identifier:e.pointerId,clientX:e.clientX,clientY:e.clientY});
        const event = e => ({touches:[...pointers.values()],changedTouches:[point(e)]});
        c.addEventListener('pointerdown', e => {
          if(e.pointerType==='mouse'&&e.button!==0)return;
          pointers.set(e.pointerId,point(e));c.setPointerCapture(e.pointerId);emit('start',event(e));
        });
        c.addEventListener('pointermove', e => {if(pointers.has(e.pointerId)){pointers.set(e.pointerId,point(e));emit('move',event(e))}});
        const end = (e,type) => {if(!pointers.delete(e.pointerId))return;emit(type,event(e))};
        c.addEventListener('pointerup',e=>end(e,'end'));c.addEventListener('pointercancel',e=>end(e,'cancel'));c.addEventListener('lostpointercapture',e=>end(e,'cancel'));
        c.addEventListener('wheel',e=>{
          const value={clientX:e.clientX,clientY:e.clientY,deltaY:e.deltaY,deltaMode:e.deltaMode};
          let handled=false;for(const fn of listeners.wheel)if(fn(value))handled=true;
          if(handled)e.preventDefault();
        },{passive:false});
      }
      return c;
    },
    getWindowInfo(){
      const canvas=main?.getBoundingClientRect();
      const width=canvas?.width||innerWidth,height=canvas?.height||innerHeight;
      const style=getComputedStyle(safeAreaProbe);
      const inset=edge=>parseFloat(style['padding'+edge])||0;
      return {windowWidth:width,windowHeight:height,pixelRatio:devicePixelRatio,
        safeArea:{left:inset('Left'),top:inset('Top'),right:width-inset('Right'),bottom:height-inset('Bottom')}};
    },
    isFullscreen,
    canFullscreen:()=>isFullscreen()||!!(document.fullscreenEnabled||document.webkitFullscreenEnabled),
    async toggleFullscreen(){
      if(isFullscreen()){
        const exit=document.exitFullscreen||document.webkitExitFullscreen;
        await exit.call(document);
      }else{
        const root=document.documentElement,enter=root.requestFullscreen||root.webkitRequestFullscreen;
        await enter.call(root);
      }
    },
    getStorageSync:key=>{try{return JSON.parse(localStorage.getItem(key))}catch{return null}},
    setStorageSync:(key,value)=>localStorage.setItem(key,JSON.stringify(value)),
    onTouchStart:fn=>listeners.start.push(fn),onTouchMove:fn=>listeners.move.push(fn),onTouchEnd:fn=>listeners.end.push(fn),onTouchCancel:fn=>listeners.cancel.push(fn),onMouseWheel:fn=>listeners.wheel.push(fn),
    onHide:fn=>listeners.hide.push(fn),onShow:fn=>listeners.show.push(fn),onWindowResize:fn=>listeners.resize.push(fn),
    vibrateShort:()=>navigator.vibrate?.(15),
    // 用 HTMLAudioElement 模拟微信小游戏的 InnerAudioContext，让同一套音乐代码跑在浏览器里。
    createInnerAudioContext() {
      const el = new Audio();el.preload='auto';
      return {
        get src(){return el.getAttribute('src')||''},set src(v){el.src=v},
        get loop(){return el.loop},set loop(v){el.loop=!!v},
        get volume(){return el.volume},set volume(v){el.volume=Math.max(0,Math.min(1,Number(v)||0))},
        get autoplay(){return el.autoplay},set autoplay(v){el.autoplay=!!v},
        play(){return el.play()},pause(){el.pause()},
        stop(){el.pause();try{el.currentTime=0}catch{}},
        seek(t){try{el.currentTime=t}catch{}},
        destroy(){el.pause();el.removeAttribute('src');el.load()},
        onError(fn){el.addEventListener('error',()=>fn({errMsg:'audio playback error'}))},
        onEnded(fn){el.addEventListener('ended',fn)},
        onCanplay(fn){el.addEventListener('canplay',fn)},
      };
    },
    showModal,
  };
  const hide = () => {pointers.clear();emit('cancel',{touches:[],changedTouches:[]});emit('hide')};
  document.addEventListener('visibilitychange',()=>{if(document.hidden)hide();else emit('show')});
  window.addEventListener('pagehide',hide);
  window.addEventListener('pageshow',event=>{if(event.persisted&&!document.hidden)emit('show')});
  window.addEventListener('resize',()=>emit('resize'));
  window.visualViewport?.addEventListener('resize',()=>emit('resize'));
  document.addEventListener('fullscreenchange',()=>emit('resize'));
  document.addEventListener('webkitfullscreenchange',()=>emit('resize'));
})();
