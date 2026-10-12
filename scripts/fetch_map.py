"""Fetch one bounded OpenStreetMap extract; the application never calls a map API."""
import pathlib, urllib.request

root = pathlib.Path(__file__).resolve().parents[1]
url='https://api.openstreetmap.org/api/0.6/map?bbox=73.846,18.508,73.864,18.524'
request=urllib.request.Request(url,headers={'User-Agent':'PuneDarshanDAAStudentProject/1.0'})
with urllib.request.urlopen(request,timeout=90) as response: data=response.read()
(root/'data'/'osm-source.xml').write_bytes(data)
print('Saved',len(data),'bytes of OSM XML. Run build_map.py to regenerate the application data.')
