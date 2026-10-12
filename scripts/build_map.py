"""Convert the OSM XML extract into offline drawing data and a pedestrian graph.
Road junction topology is retained; degree-two chains keep their full geometry.
Mandal coordinates identify representative street approaches, not verified gates.
"""
import xml.etree.ElementTree as ET
import math, json, pathlib, collections
ROOT=pathlib.Path(__file__).resolve().parents[1]
tree=ET.parse(ROOT/'data/osm-source.xml').getroot()
SCALEX=111195*math.cos(math.radians(18.516)); SCALEY=111195
def xy(lat,lon): return [round((lon-73.846)*SCALEX,2),round((18.524-lat)*SCALEY,2)]
coords={n.attrib['id']:xy(float(n.attrib['lat']),float(n.attrib['lon'])) for n in tree.findall('node')}
def tags(e): return {t.attrib['k']:t.attrib['v'] for t in e.findall('tag')}
def dist(a,b): return math.dist(a,b)
roads=[]; buildings=[]; parks=[]; raw={}; adj=collections.defaultdict(list)
allowed={'residential','service','tertiary','tertiary_link','secondary','secondary_link','primary','primary_link','living_street','unclassified','footway','pedestrian','steps','path','track'}
for w in tree.findall('way'):
    t=tags(w); ids=[n.attrib['ref'] for n in w.findall('nd') if n.attrib['ref'] in coords]
    points=[coords[n] for n in ids]
    if len(points)<2: continue
    if 'building' in t: buildings.append(points)
    if t.get('leisure')=='park': parks.append(points)
    if 'highway' in t:
        roads.append({'points':points,'name':t.get('name',''),'kind':t['highway']})
        if t['highway'] not in allowed or t.get('foot')=='no' or t.get('access') in ['private','no']: continue
        for a,b in zip(ids,ids[1:]):
            if a==b or not all(-20<c[0]<1940 and -20<c[1]<1800 for c in [coords[a],coords[b]]): continue
            key=tuple(sorted((a,b)))
            if key in raw: continue
            raw[key]={'a':a,'b':b,'name':t.get('name','Pedestrian lane'),'kind':t['highway']}
            adj[a].append(b); adj[b].append(a)
seen=set(); components=[]
for n in adj:
    if n in seen: continue
    q=[n]; seen.add(n); component=[]
    while q:
        v=q.pop(); component.append(v)
        for nb in adj[v]:
            if nb not in seen: seen.add(nb); q.append(nb)
    components.append(component)
main=set(max(components,key=len))
places=[
 {'id':'shaniwar','name':'Shaniwar Wada','mr':'शनिवार वाडा','short':'Shaniwar Wada','lat':18.51955,'lon':73.85525,'type':'start','area':'Shaniwar Peth','description':'Begin your walk at the historic fort approach.'},
 {'id':'mandai-start','name':'Mandai Metro approach','mr':'मंडई मेट्रो','short':'Mandai Metro','lat':18.5124,'lon':73.8567,'type':'start','area':'Shukrawar Peth','description':'A southern starting point near Mandai.'},
 {'id':'kasba','name':'Shri Kasba Ganpati','mr':'श्री कसबा गणपती','short':'Kasba Ganpati','lat':18.5190304,'lon':73.8572406,'rank':1,'area':'Kasba Peth','description':'Pune’s Gramdaivat and the first of the five honoured Ganpati.'},
 {'id':'tambdi','name':'Tambdi Jogeshwari','mr':'तांबडी जोगेश्वरी','short':'Tambdi Jogeshwari','lat':18.5165314,'lon':73.8547653,'rank':2,'area':'Budhwar Peth','description':'The second Manacha Ganpati, beside the Jogeshwari temple.'},
 {'id':'guruji','name':'Guruji Talim Ganpati','mr':'गुरुजी तालीम गणपती','short':'Guruji Talim','lat':18.5150471,'lon':73.8546601,'rank':3,'area':'Budhwar Peth','description':'The third honoured mandal, rooted in the local talim tradition.'},
 {'id':'tulshi','name':'Tulshibaug Ganpati','mr':'तुळशीबाग गणपती','short':'Tulshibaug','lat':18.514268,'lon':73.855306,'rank':4,'area':'Budhwar Peth','description':'The fourth Manacha Ganpati in Pune’s lively market district.'},
 {'id':'kesari','name':'Kesariwada Ganpati','mr':'केसरीवाडा गणपती','short':'Kesariwada','lat':18.5161,'lon':73.8491,'rank':5,'area':'Narayan Peth','description':'The fifth honoured Ganpati, associated with Lokmanya Tilak’s wada.'},
 {'id':'dagdu','name':'Dagdusheth Halwai','mr':'दगडूशेठ हलवाई','short':'Dagdusheth','lat':18.5164834,'lon':73.8560354,'area':'Budhwar Peth','description':'A famous additional destination. This pin uses the mapped temple approach, not a seasonal pavilion.'},
 {'id':'babu','name':'Hutatma Babu Genu','mr':'हुतात्मा बाबू गेनू','short':'Babu Genu','lat':18.51389,'lon':73.856342,'area':'Budhwar Peth','description':'An optional darshan stop near the central market lanes.'},
 {'id':'rangari','name':'Bhausaheb Rangari','mr':'भाऊसाहेब रंगारी','short':'Bhausaheb Rangari','lat':18.5175,'lon':73.8555,'area':'Budhwar Peth','description':'A historic additional mandal near the central peth lanes.'},
 {'id':'mandai','name':'Akhil Mandai Mandal','mr':'अखिल मंडई मंडळ','short':'Akhil Mandai','lat':18.511852,'lon':73.856135,'area':'Shukrawar Peth','description':'An additional stop near Mahatma Phule Mandai.'},
 {'id':'jilbya','name':'Jilbya Maruti Mandal','mr':'जिलब्या मारुती','short':'Jilbya Maruti','lat':18.513319,'lon':73.854938,'area':'Shukrawar Peth','description':'An optional neighbourhood darshan stop.'},
]
critical={n for n in main if len([b for b in adj[n] if b in main])!=2}
for p in places:
    original=xy(p['lat'],p['lon']); p['osmNode']=min(main,key=lambda n:dist(coords[n],original))
    p['approachOffset']=round(dist(original,coords[p['osmNode']]))
    critical.add(p['osmNode'])
nodes=[{'id':n,'x':coords[n][0],'y':coords[n][1]} for n in sorted(critical)]
indices={n['id']:i for i,n in enumerate(nodes)}
edges=[]; walked=set()
for a in critical:
    for b in adj[a]:
        if b not in main or tuple(sorted((a,b))) in walked: continue
        path=[a,b]; walked.add(tuple(sorted((a,b)))); previous,current=a,b
        while current not in critical:
            choices=[n for n in adj[current] if n in main and n!=previous]
            if not choices: break
            nxt=choices[0]; walked.add(tuple(sorted((current,nxt)))); path.append(nxt); previous,current=current,nxt
        if current not in critical or a==current: continue
        points=[coords[n] for n in path]; segments=[raw[tuple(sorted((v,w)))] for v,w in zip(path,path[1:])]
        name=collections.Counter(s['name'] for s in segments).most_common(1)[0][0]
        edges.append({'a':indices[a],'b':indices[current],'points':points,'length':math.ceil(sum(dist(v,w) for v,w in zip(points,points[1:]))*1000)/1000,'name':name,'kind':segments[0]['kind']})
for p in places:
    p['node']=indices[p.pop('osmNode')]; p['x']=nodes[p['node']]['x']; p['y']=nodes[p['node']]['y']
metadata={'source':'OpenStreetMap contributors','license':'ODbL 1.0','extracted':'2026-10-11','bbox':[18.508,73.846,18.524,73.864],'note':'Educational simulation. OSM street topology; representative street approaches. Festival entries and restrictions require local verification.'}
data={'metadata':metadata,'nodes':nodes,'edges':edges,'roads':roads,'buildings':buildings,'parks':parks,'places':places}
(ROOT/'data/map.json').write_text(json.dumps(data,ensure_ascii=False,separators=(',',':')),encoding='utf-8')
print('Graph:',len(nodes),'junctions,',len(edges),'lanes;',len(buildings),'buildings')
print('Street approach offsets:',[(p['id'],p['approachOffset']) for p in places])
