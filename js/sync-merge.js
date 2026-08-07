(function(){
  'use strict';
  const R=window.StepProgressSync;
  R.backupModel={
    entityKey:(id,hash)=>`${String(id)}@@${String(hash||'NOHASH')}`,
    qbankKey:'__QBANK__'
  };
})();
