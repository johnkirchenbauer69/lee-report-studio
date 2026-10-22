/* Versioned operator-started assembly. Source text/tables stay native; charts/maps stay vector links. */
(function () {
  var jobDirectory=app.scriptArgs.getValue('leeReportJobDirectory');
  if(!jobDirectory)throw Error('Native job directory argument is missing');
  var root = Folder(jobDirectory), d, old = app.scriptPreferences.userInteractionLevel, oldGuides=app.pdfExportPreferences.exportGuidesAndGrids, oldHyperlinks=app.pdfExportPreferences.includeHyperlinks, oldRedraw=app.scriptPreferences.enableRedraw;
  if (app.documents.length) throw Error('Close InDesign documents before export.');
  function read(name) { var f=File(root+'/'+name); if(!f.open('r'))throw Error('Missing '+name);f.encoding='UTF-8';var s=f.read();f.close();return eval('('+s+')'); }
  function write(name,value) {var f=File(root+'/'+name);f.encoding='UTF-8';if(!f.open('w'))throw Error('Cannot write '+name);f.write(value);f.close();}
  var model=read('master.json'), errors=[], counts={text:0,tables:0};
  var colors={}, paragraphs={};
  function color(hex) {
    if(!hex||hex==='transparent'||hex==='rgba(0, 0, 0, 0)')return d.swatches.itemByName('None');
    if(hex.indexOf('rgb')===0){var a=hex.match(/[\d.]+/g);hex='#';for(var j=0;j<3;j++){var h=Number(a[j]).toString(16);hex+=(h.length===1?'0':'')+h;}}
    if(colors[hex])return colors[hex];
    return colors[hex]=d.colors.add({name:'LEE '+hex,model:ColorModel.PROCESS,space:ColorSpace.RGB,colorValue:[parseInt(hex.substr(1,2),16),parseInt(hex.substr(3,2),16),parseInt(hex.substr(5,2),16)]});
  }
  function bounds(r){return [r.y*.75,r.x*.75,(r.y+r.height)*.75,(r.x+r.width)*.75];}
  function paragraph(s) {
    var key=s.fontName+' '+s.fontSizePt+' '+s.leadingPt+' '+s.hex+' '+s.textAlign;
    if(paragraphs[key])return paragraphs[key];
    var font;try{font=d.fonts.itemByName(s.fontName);if(!font.isValid)throw Error('Invalid font');}catch(fontError){throw Error('Font lookup failed: '+s.fontName);}if(!font.isValid)throw Error('Pinned native font not activated: '+s.fontName);
    var p=d.paragraphStyles.add({name:'LEE '+key,pointSize:s.fontSizePt,leading:s.leadingPt,fillColor:color(s.hex),hyphenation:false,spaceBefore:0,spaceAfter:0});
    p.appliedFont=font;p.fontStyle=s.fontName.split('\t')[1];
    p.justification=Justification.LEFT_ALIGN;
    if(s.textAlign==='center')p.justification=Justification.CENTER_ALIGN;
    else if(s.textAlign==='right')p.justification=Justification.RIGHT_ALIGN;
    else if(s.textAlign==='justify')p.justification=Justification.FULLY_JUSTIFIED;
    p.composer='Adobe Single-line Composer';return paragraphs[key]=p;
  }
  function hyperlink(item,url) {if(!url||!/^https?:|^mailto:/i.test(url))return;var dest=d.hyperlinkURLDestinations.add(url);d.hyperlinks.add(d.hyperlinkPageItemSources.add(item),dest,{visible:false});}
  function effects(item,e) {
    var s=e.style||{},shadow=s.shadow;
    if(s.opacity!==undefined)item.transparencySettings.blendingSettings.opacity=s.opacity*100;
    if(shadow&&shadow.enabled)item.transparencySettings.dropShadowSettings.properties={mode:ShadowMode.DROP,blendMode:BlendMode.NORMAL,effectColor:color(shadow.color),opacity:shadow.opacity*100,xOffset:shadow.offsetX*.75,yOffset:shadow.offsetY*.75,size:shadow.blur*.75,useGlobalLight:false};
  }
  function text(page,e) {
    var s=e.dom.style,r=e.rotation?{x:e.x,y:e.y,width:e.width,height:e.height}:e.dom.rect;
    var frame=page.textFrames.add({geometricBounds:bounds(r),contents:e.dom.text.replace(/\r?\n/g,'\r'),fillColor:none,strokeColor:none});
    frame.textFramePreferences.insetSpacing=0;frame.textFramePreferences.firstBaselineOffset=FirstBaseline.ASCENT_OFFSET;
    if(e.firstBaseline!==undefined&&!e.rotation){frame.textFramePreferences.firstBaselineOffset=FirstBaseline.FIXED_HEIGHT;frame.textFramePreferences.minimumFirstBaselineOffset=e.firstBaseline;}
    if(e.rotation&&e.style&&e.style.typography&&e.style.typography.verticalAlign==='middle')frame.textFramePreferences.verticalJustification=VerticalJustification.CENTER_ALIGN;
    frame.parentStory.texts[0].applyParagraphStyle(paragraph(s),true);
    frame.label=e.id;counts.text++;
    if(e.rotation) {frame.rotationAngle=-e.rotation;var gb=frame.geometricBounds;frame.move(undefined,[(r.x+r.width/2)*.75-(gb[1]+gb[3])/2,(r.y+r.height/2)*.75-(gb[0]+gb[2])/2]);}
    effects(frame,e);hyperlink(frame,e.dom.url);return frame;
  }
  function shape(page,e) {
    var s=e.style||{},fill=s.fill,sw=color(s.background||'#ffffff');
    if(fill&&fill.type==='solid')sw=color(fill.color);
    if(fill&&fill.type==='linear-gradient') {sw=d.gradients.add({name:e.id,type:GradientType.LINEAR});var stops=fill.stops;sw.gradientStops[0].properties={stopColor:color(stops[0].color),location:0};sw.gradientStops[1].properties={stopColor:color(stops[stops.length-1].color),location:100};}
    // ExtendScript misassociates nested conditional expressions involving host
    // collections/enums. Explicit branches preserve circles and alignment.
    var props={geometricBounds:bounds(e.dom.rect),fillColor:sw,strokeColor:none},item;
    if(e.shape==='circle')item=page.ovals.add(props);
    else if(e.shape==='path')item=page.polygons.add(props);
    else item=page.rectangles.add(props);
    if(e.shape==='path'&&e.pathGeometry){var points=[],ring=e.pathGeometry.rings[0];for(var k=0;k<ring.length;k++)points.push([(e.x+ring[k].x*e.width)*.75,(e.y+ring[k].y*e.height)*.75]);item.paths[0].entirePath=points;}
    if(fill&&fill.type==='linear-gradient'){item.gradientFillAngle=90-fill.angle;item.gradientFillStart=[e.dom.rect.x*.75,e.dom.rect.y*.75];item.gradientFillLength=(fill.angle===180?e.dom.rect.height:e.dom.rect.width)*.75;}
    var corners=['topLeft','topRight','bottomRight','bottomLeft'];for(var k=0;k<4;k++){var radius=s.cornerRadii?s.cornerRadii[corners[k]]:s.borderRadius||0;if(radius){item[corners[k]+'CornerOption']=CornerOptions.ROUNDED_CORNER;item[corners[k]+'CornerRadius']=radius*.75;}}
    if(s.opacity!==undefined)item.transparencySettings.blendingSettings.opacity=s.opacity*100;
    item.label=e.id;effects(item,e);return item;
  }
  function graphic(page,e) {
    var frame=page.rectangles.add({geometricBounds:bounds(e.dom.rect),fillColor:none,strokeColor:none});
    frame.place(File(root+'/'+e.link));
    var im=e.dom.image;
    frame.fit(im&&im.fit==='cover'?FitOptions.FILL_PROPORTIONALLY:FitOptions.PROPORTIONALLY);frame.fit(FitOptions.CENTER_CONTENT);
    if(im&&im.rect&&im.width&&im.height&&e.type==='image') {
      var r=im.rect,w=r.width,h=r.height,scale;
      if(!e.sourceCrop&&im.fit!=='fill') {
        scale=1;
        if(im.fit==='cover')scale=Math.max(w/im.width,h/im.height);
        else if(im.fit!=='none')scale=Math.min(w/im.width,h/im.height);
        w=im.width*scale;h=im.height*scale;
      }
      var position=(im.position||'50% 50%').split(' '),px=parseFloat(position[0])/100,py=parseFloat(position[1])/100;
      frame.allGraphics[0].geometricBounds=bounds({x:r.x+(r.width-w)*px,y:r.y+(r.height-h)*py,width:w,height:h});
    }
    frame.label=e.id;effects(frame,e);hyperlink(frame,e.dom.url);return frame;
  }
  function table(page,e) {
    var cells=e.dom.cells,cols=e.columns.length,rows=cells.length/cols;
    if(rows!==Math.floor(rows)||rows<1)throw Error('Invalid table grid '+e.id);
    var r=e.dom.rect,finalBounds=bounds(r);finalBounds[2]+=3;var gb=[finalBounds[0],finalBounds[1],792,finalBounds[3]];
    var frame=page.textFrames.add({geometricBounds:gb,fillColor:none,strokeColor:none});frame.textFramePreferences.insetSpacing=0;frame.label=e.id;
    frame.parentStory.pointSize=1;frame.parentStory.leading=1;
    var t=frame.insertionPoints[0].tables.add({bodyRowCount:rows-1,headerRowCount:1,columnCount:cols});
    t.width=r.width*.75;
    for(var c=0;c<cols;c++)t.columns[c].width=cells[c].rect.width*.75;
    for(var row=0;row<rows;row++) {
      t.rows[row].autoGrow=false;t.rows[row].height=cells[row*cols].rect.height*.75;
      for(var c=0;c<cols;c++) {var source=cells[row*cols+c],cell=t.rows[row].cells[c];
        cell.contents=source.text.replace(/\n/g,'\r');cell.texts[0].applyParagraphStyle(paragraph(source.style),true);
        cell.topInset=0;cell.bottomInset=0;cell.leftInset=source.style.paddingLeft*.75;cell.rightInset=source.style.paddingRight*.75;
        // Browser numeric cells use nowrap and can consume their padding area.
        // Symmetric zero insets retain the same center without shrinking type.
        if(row>0&&source.style.textAlign==='center'&&/^[-+$\d,.\s%]+$/.test(source.text)){cell.leftInset=0;cell.rightInset=0;cell.texts[0].noBreak=true;}
        cell.verticalJustification=VerticalJustification.TOP_ALIGN;
        if(source.baseline!==undefined){cell.firstBaselineOffset=FirstBaseline.FIXED_HEIGHT;cell.minimumFirstBaselineOffset=source.baseline;}
        var fill=source.style.background;if(!fill||fill==='rgba(0, 0, 0, 0)')fill=source.rowBackground;
        if(!fill||fill==='rgba(0, 0, 0, 0)')fill=row===0?'#c4123f':'#ffffff';
        cell.fillColor=color(fill);
        // Adjacent native cells share an edge: resetting the next row's top
        // edge to zero erases the previous row's bottom rule.
        var previous=row>0?cells[(row-1)*cols+c]:null;
        cell.topEdgeStrokeWeight=previous?(previous.style.borderBottomWidth||0)*.75:0;
        cell.topEdgeStrokeColor=color(previous?previous.style.borderBottomColor:'#9ca3af');
        cell.leftEdgeStrokeWeight=0;cell.rightEdgeStrokeWeight=0;
        cell.bottomEdgeStrokeWeight=(source.style.borderBottomWidth||0)*.75;
        cell.bottomEdgeStrokeColor=color(source.style.borderBottomColor);
        if(source.directionRect){var ar=source.directionRect,up=source.direction.indexOf('M5 1')>=0;
          var tri=page.polygons.add({geometricBounds:bounds(ar),fillColor:color(source.directionColor),strokeColor:none});
          tri.paths[0].entirePath=up?[[(ar.x+5)*.75,(ar.y+1)*.75],[(ar.x+10)*.75,(ar.y+9)*.75],[ar.x*.75,(ar.y+9)*.75]]:[[ar.x*.75,(ar.y+1)*.75],[(ar.x+10)*.75,(ar.y+1)*.75],[(ar.x+5)*.75,(ar.y+9)*.75]];
          if(source.direction.indexOf('<rect')>=0)tri.paths[0].entirePath=[[ar.x*.75,(ar.y+3.5)*.75],[(ar.x+10)*.75,(ar.y+3.5)*.75],[(ar.x+10)*.75,(ar.y+6.5)*.75],[ar.x*.75,(ar.y+6.5)*.75]];
          cell.leftInset=(ar.x+ar.width+4-source.rect.x)*.75;tri.label=e.id+' direction '+row;
        }
      }
    }
    if(e.variant==='indicators'){
      var header=cells[0].rect;
      var bg=shape(page,{id:e.id+' header',dom:{rect:{x:r.x,y:header.y,width:r.width,height:header.height}},style:{fill:{type:'linear-gradient',angle:180,stops:[{color:'#cf123f'},{color:'#3d0a16'}]},cornerRadii:{topLeft:15,topRight:15,bottomLeft:0,bottomRight:0}}});
      bg.sendToBack();for(var c=0;c<cols;c++)t.rows[0].cells[c].fillColor=none;
    }
    frame.geometricBounds=finalBounds;counts.tables++;return frame;
  }
  function audit(doc) {
    var frames=doc.textFrames.everyItem().getElements(),links=doc.links.everyItem().getElements(),fonts=doc.fonts.everyItem().getElements();
    var result={pageCount:doc.pages.length,missingLinks:0,substitutedFonts:0,oversetFrames:0,oversetCells:0,nativeTextFrames:frames.length,nativeTables:0};
    for(var i=0;i<links.length;i++)if(links[i].status!==LinkStatus.NORMAL)result.missingLinks++;
    for(var i=0;i<fonts.length;i++)if(fonts[i].status!==FontStatus.INSTALLED)result.substitutedFonts++;
    for(var i=0;i<frames.length;i++){var f=frames[i];if(f.overflows){result.oversetFrames++;errors.push('Overset '+f.label);}var tables=f.tables.length?f.tables.everyItem().getElements():[];for(var j=0;j<tables.length;j++){result.nativeTables++;var cells=tables[j].cells.everyItem().getElements();for(var k=0;k<cells.length;k++)if(cells[k].overflows)result.oversetCells++;}}
    return result;
  }
  try {
    app.scriptPreferences.userInteractionLevel=UserInteractionLevels.NEVER_INTERACT;
    app.scriptPreferences.enableRedraw=false;
    d=app.documents.add(false);d.documentPreferences.properties={facingPages:false,pageWidth:'612pt',pageHeight:'792pt',pagesPerDocument:model.pages};
    d.preflightOptions.preflightOff=true;
    for(var fi=0;fi<model.fonts.length;fi++){var descriptor=model.fonts[fi];var pinnedFont=d.createMissingFontObject(descriptor.family,descriptor.style,descriptor.postscript);var seed=d.pages[0].textFrames.add({geometricBounds:[0,0,12,300],contents:'Font activation'});seed.parentStory.appliedFont=pinnedFont;}
    d.save(File(root+'/Report.indd'));d.close(SaveOptions.NO);d=app.open(File(root+'/Report.indd'),false);
    for(var fi=0;fi<model.fonts.length;fi++){var descriptor=model.fonts[fi];var activated=d.fonts.itemByName(descriptor.family+'\t'+descriptor.style);var pin=d.paragraphStyles.add({name:'Pinned font '+fi});pin.appliedFont=activated;pin.fontStyle=descriptor.style;}
    while(d.textFrames.length)d.textFrames[0].remove();
    d.viewPreferences.horizontalMeasurementUnits=MeasurementUnits.POINTS;d.viewPreferences.verticalMeasurementUnits=MeasurementUnits.POINTS;
    d.transparencyPreferences.blendingSpace=BlendingSpace.RGB;
    var none=d.swatches.itemByName('None');
    var lastPage=-1;
    for(var i=0;i<model.elements.length;i++) {var e=model.elements[i],page=d.pages[e.page];try{
      if(e.page!==lastPage){lastPage=e.page;write('native-progress.txt','Assembling page '+(lastPage+1)+' of '+model.pages);}
      if(e.type==='text')text(page,e);else if(e.type==='shape')shape(page,e);else if(e.type==='table')table(page,e);else if(e.link)graphic(page,e);
    }catch(err){errors.push(e.id+': '+err.message+' line '+err.line);}}
    write('native-progress.txt','Validating assembled document');
    d.recompose();d.save();var initial=audit(d);if(initial.missingLinks||initial.substitutedFonts||initial.oversetCells)errors.push('Validation: links='+initial.missingLinks+' fonts='+initial.substitutedFonts+' cells='+initial.oversetCells);write('assembly-errors.txt',errors.join('\n'));
    if(errors.length)throw Error('Native assembly requires correction: '+errors.length+' issues; see assembly-errors.txt');
    d.close(SaveOptions.NO);d=app.open(File(root+'/Report.indd'),false);d.recompose();var result=audit(d);result.reopened=true;
    app.pdfExportPreferences.exportGuidesAndGrids=false;app.pdfExportPreferences.includeHyperlinks=true;result.hyperlinks=d.hyperlinks.length;
    write('native-progress.txt','Exporting PDF');d.exportFile(ExportFormat.PDF_TYPE,File(root+'/Report.pdf'));
    // IDML is not included until a separate actual import and export passes.
    result.idmlImportValidated=false;result.relocated=false;
    d.close(SaveOptions.NO);d=null;
    var relocation=Folder(root+'/Relocation-check');relocation.create();
    function copyFolder(from,to){to.create();var files=from.getFiles();for(var i=0;i<files.length;i++){if(files[i] instanceof Folder)copyFolder(files[i],Folder(to+'/'+files[i].name));else if(!files[i].copy(to+'/'+files[i].name))throw Error('Relocation copy failed');}}
    copyFolder(Folder(root+'/Links'),Folder(relocation+'/Links'));copyFolder(Folder(root+'/Document fonts'),Folder(relocation+'/Document fonts'));
    if(!File(root+'/Report.indd').copy(relocation+'/Report.indd'))throw Error('INDD relocation copy failed');
    write('native-progress.txt','Validating relocated package');d=app.open(File(relocation+'/Report.indd'),false);
    for(var li=0;li<d.links.length;li++){var target=File(relocation+'/Links/'+d.links[li].name);if(!target.exists)throw Error('Relocated link missing');d.links[li].relink(target);d.links[li].update();}
    var relocated=audit(d);if(relocated.missingLinks||relocated.substitutedFonts||relocated.oversetFrames||relocated.oversetCells||d.hyperlinks.length!==result.hyperlinks)throw Error('Relocation validation failed');
    d.save();d.exportFile(ExportFormat.PDF_TYPE,File(relocation+'/Report.pdf'));d.close(SaveOptions.NO);d=null;result.relocated=true;
    var fields=[];for(var key in result)if(result.hasOwnProperty(key))fields.push('"'+key+'":'+result[key]);write('native-validation.json','{'+fields.join(',')+'}');
  } catch(failure) {write('native-failure.txt',String(failure)+'; '+failure.message+'; line '+failure.line);throw failure;}
  finally {if(d&&d.isValid)d.close(SaveOptions.NO);app.scriptPreferences.userInteractionLevel=old;app.pdfExportPreferences.exportGuidesAndGrids=oldGuides;app.pdfExportPreferences.includeHyperlinks=oldHyperlinks;app.scriptPreferences.enableRedraw=oldRedraw;}
})();
