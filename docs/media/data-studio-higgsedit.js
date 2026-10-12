export default async ({project,rect,text,frame}) => {
const p=await project({dir:"/home/user/vanteloq-data-studio",size:"1920x1080",fps:30,background:"#050608"});
const ink="#f5f7fb", muted="#b4becd", line="#303b4d", blue="#78b2ff";
const t=(s,x,y,w,size=30,color=ink,weight=400)=>text(s,{x,y,width:w,height:size*1.7,fontFamily:"Inter",fontSize:size,fontWeight:weight,color});
const r=(x,y,w,h,fill="#0e1118",radius=20)=>rect({x,y,width:w,height:h,fill,radius,strokeColor:line,strokeWidth:1});
const intro={enter:{from:{y:18,opacity:0},duration:.65,easing:"house"}};
const tabs=["Overview","Sales","Margin","Inventory","Cash","Data Quality","Sources"];
p.compose([t("VANTELOQ",104,54,600,26,blue,700),t("Your numbers. Ready for Excel.",104,102,1600,64,ink,700),r(104,230,1712,740,"#0e1118",28),t("Data Studio  /  Executive Review",148,266,1150,34,ink,600),t("Fictional sample records",1390,274,365,23,muted),r(148,338,1624,64,"#151b25",12),...tabs.map((s,i)=>t(s,176+i*227,354,218,23,muted,600)),t("Sales, margins and permitted BookLoQ figures.",148,1006,1250,26,muted),t("7 sheets",1574,1006,200,26,blue,600)],{dur:12,name:"Executive Review shell"});
function scene(at,dur,name,children) { p.compose(frame({x:148,y:438,width:1624,height:480,layout:"none",motion:{...intro,exit:{to:{opacity:0},duration:.25,anchor:"end"}}},children),{at,dur,name}); }
scene(0,4.2,"Overview",[
r(0,0,514,150,"#151b25"),r(554,0,514,150,"#151b25"),r(1108,0,516,150,"#151b25"),
t("Recorded net sales",26,20,470,25,muted),t("CAD $14,200",26,65,470,50,ink,700),
t("Recorded gross profit",580,20,470,25,muted),t("CAD $5,200",580,65,470,50,ink,700),
t("Weighted gross margin",1134,20,470,25,muted),t("36.6%",1134,65,470,50,ink,700),
t("A clear review. The source notes travel with it.",0,202,1600,40,ink,600),
t("Choose your period and scope. Inspect the recorded figures before exporting.",0,280,1600,29,muted),
t("Missing or restricted information stays labelled.",0,350,1500,29,blue,600)
]);
const rows=[["0001","2026-09-01","CAD $8,700","CAD $5,500"],["0002","2026-09-02","CAD $5,700","CAD $3,600"],["0003","2026-09-03","-CAD $200","-CAD $100"]];
scene(4,4.2,"Source rows",[
t("Follow the total into the recorded rows.",0,0,1600,40,ink,600),
r(0,84,1624,64,"#151b25",10),
t("Record ID",26,96,260,26,muted,600),t("Business date",322,96,420,26,muted,600),t("Net sales",842,96,360,26,muted,600),t("Recorded cost",1222,96,376,26,muted,600),
...rows.flatMap((row,i)=>[r(0,164+i*76,1624,64,"#0e1118",8),...row.map((s,j)=>t(s,[26,322,842,1222][j],176+i*76,[260,420,360,376][j],28,j>1?ink:muted))]),
t("Identifiers stay text. Amounts retain their exact minor units.",0,420,1600,28,blue,600)
]);
scene(8,4,"Workbook",[
r(0,0,585,460,"#151b25",22),t("Executive Review.xlsx",28,30,535,36,ink,600),
...tabs.map((s,i)=>t(s,36,102+i*47,510,26,i===0?blue:muted,i===0?600:400)),
t("Seven sheets. One traceable review.",655,34,950,48,ink,700),
t("Source notes and missing-data boundaries",655,152,950,30,muted),
t("Precomputed values. No macros or formulas.",655,218,950,30,muted),
r(655,322,440,78,"#1d60dc",16),t("Reports  >  Data Studio",680,340,398,27,"#ffffff",600)
]);
await p.frame(2.2,"renders/poster.png");
await p.frame(5.2,"renders/sales.png");
await p.frame(10,"renders/workbook.png");
};
