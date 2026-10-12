import urllib.request, re, concurrent.futures
slugs=['kasba-ganpati','tambdi-jogeshwari','guruji-talim','tulshibaug-ganpati','kesariwada-ganpati','dagdusheth-halwai-ganpati','hutatma-babu-genu-mandal','bhausaheb-rangari-ganpati','akhil-mandai-mandal','jilbya-maruti-mandal']
def get(s):
    try:
        html=urllib.request.urlopen('https://ganpatipune.in/ganpati/'+s,timeout=20).read().decode()
        return s, re.findall(r'https://www.google.com/maps[^\"<> ]+',html)[:1]
    except Exception as e: return s,str(e)
with concurrent.futures.ThreadPoolExecutor(max_workers=5) as pool:
    for result in pool.map(get,slugs): print(result)
