# -*- coding: utf-8 -*-
"""为前端交互测试造 mock 数据：新建测试项目 6 并灌入大纲/人物/世界/伏笔/时间线。"""
import json
import urllib.request

BASE = 'http://127.0.0.1:8000'


def call(method, path, body=None):
    data = json.dumps(body).encode('utf-8') if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, method=method,
                                 headers={'Content-Type': 'application/json'})
    with urllib.request.urlopen(req) as r:
        raw = r.read()
        return json.loads(raw) if raw else None


def post(path, body):
    return call('POST', path, body)


# 1. 新建测试项目
p = post('/projects', {'title': '测试用书', 'genre': '玄幻', 'synopsis': '用于前端交互测试的 mock 数据', 'tones': ['热血']})
PID = p['id']
print('PROJECT', PID)

# 2. 大纲：一卷 + 两节点
v = post('/outline', {'project_id': PID, 'title': '第一卷 入道', 'summary': '少年从灵田走向宗门'})
n1 = post('/outline', {'project_id': PID, 'parent_id': v['id'], 'title': '铁条认主', 'summary': '千骨铁条苏醒', 'tension': 6, 'status': '定稿'})
n2 = post('/outline', {'project_id': PID, 'parent_id': v['id'], 'title': '宗门入门', 'summary': '拜入净元宗', 'tension': 4, 'status': '写作中'})
print('OUTLINE', v['id'], n1['id'], n2['id'])

# 3. 人物 + 关系
c1 = post('/characters', {'project_id': PID, 'name': '陈默', 'gender': '男', 'role': '主角',
                          'appearance': '干瘦少年，右手旧疤', 'surface_goal': '摆脱废灵根',
                          'deep_need': '被承认', 'secret': '体内有千骨器灵', 'arc': '废柴到强者'})
c2 = post('/characters', {'project_id': PID, 'name': '陈九', 'gender': '男', 'role': '对手',
                          'appearance': '灵力充沛的少爷', 'surface_goal': '维持家族地位', 'deep_need': '安全感'})
c3 = post('/characters', {'project_id': PID, 'name': '玄尘真人', 'gender': '男', 'role': '长老',
                          'appearance': '灰袍老者', 'surface_goal': '寻找传人', 'deep_need': '赎罪'})
print('CHARS', c1['id'], c2['id'], c3['id'])
post('/relations', {'project_id': PID, 'src_kind': 'char', 'src_id': c1['id'], 'dst_kind': 'char', 'dst_id': c2['id'], 'type': '对抗', 'label': '家族压迫'})
post('/relations', {'project_id': PID, 'src_kind': 'char', 'src_id': c1['id'], 'dst_kind': 'char', 'dst_id': c3['id'], 'type': '师徒', 'label': '传法'})
print('RELS OK')

# 4. 世界观
w1 = post('/world-entries', {'project_id': PID, 'name': '千骨铁条', 'category': '器物', 'content': '锈铁条，认主吸血，暗藏功法'})
w2 = post('/world-entries', {'project_id': PID, 'name': '净元宗', 'category': '势力', 'content': '北境第一宗门，收徒看灵根'})
w3 = post('/world-entries', {'project_id': PID, 'name': '陈家灵田', 'category': '地理', 'content': '灵田产出低阶灵米'})
print('WORLD', w1['id'], w2['id'], w3['id'])

# 5. 伏笔
f1 = post('/foreshadows', {'project_id': PID, 'title': '铁条认主', 'description': '千骨铁条滴血认主', 'importance': 3, 'state': '已埋设'})
f2 = post('/foreshadows', {'project_id': PID, 'title': '陈默身世', 'description': '孤儿身世成谜', 'importance': 2, 'state': '悬空'})
print('FSP', f1['id'], f2['id'])

# 6. 时间线事件
post('/timeline-events', {'project_id': PID, 'track': 'main', 'title': '铁条现世', 'time_label': '开篇', 'sort': 1, 'description': '陈默捡到千骨铁条'})
post('/timeline-events', {'project_id': PID, 'track': 'char:陈默', 'title': '初入净元宗', 'time_label': '第一卷末', 'sort': 2, 'description': '拜入宗门'})
print('TIMELINE OK')
print('ALL DONE')