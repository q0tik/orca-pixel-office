"""Draws the office animals as pixel rows and writes their packs (plugin/office/animals/*.json).

The packs are data: anyone can edit the rows by hand or write a new species file without this
script. This only keeps the shipped art reproducible.   python3 tools/make_animals.py
"""
import json
import os
import sys

ROOT = os.path.join(os.path.dirname(__file__), '..')


class Grid:
    def __init__(self, w, h):
        self.w, self.h = w, h
        self.px = [['.'] * w for _ in range(h)]

    def p(self, x, y, w, h, ch):
        for yy in range(y, y + h):
            for xx in range(x, x + w):
                if 0 <= xx < self.w and 0 <= yy < self.h:
                    self.px[yy][xx] = ch

    def rows(self):
        return [''.join(r) for r in self.px]


# ── Cat (16×12): a = fur, b = fur shade, n = nose, e = eye, w = white ──────────────────
def cat_walk(step):
    g = Grid(16, 12)
    bob = step % 2
    g.p(1, 2 + bob, 1, 5, 'a')
    g.p(2, 1 + bob, 1, 2, 'a')
    g.p(2, 5 + bob, 9, 4, 'a')
    g.p(3, 5 + bob, 2, 1, 'b')
    g.p(6, 5 + bob, 2, 1, 'b')
    g.p(10, 3 + bob, 4, 4, 'a')
    g.p(10, 2 + bob, 1, 1, 'a')
    g.p(13, 2 + bob, 1, 1, 'a')
    g.p(12, 4 + bob, 1, 1, 'e')
    g.p(14, 5 + bob, 1, 1, 'n')
    legs = [(3, 9), (9, 9)] if step in (1, 3) else [(4, 9), (8, 9)]
    for lx, ly in legs:
        g.p(lx, ly, 1, 3 - bob, 'b')
    g.p(5 if step == 1 else 6, 9, 1, 3 - bob, 'b')
    return g.rows()


def cat_sleep(breath):
    g = Grid(16, 12)
    b = breath
    g.p(3, 6 + b, 10, 5 - b, 'a')
    g.p(2, 7 + b, 12, 4 - b, 'a')
    g.p(4, 7 + b, 2, 1, 'b')
    g.p(7, 6 + b, 2, 1, 'b')
    g.p(10, 7 + b, 2, 1, 'b')
    g.p(10, 5 + b, 4, 4, 'a')
    g.p(10, 4 + b, 1, 1, 'b')
    g.p(13, 4 + b, 1, 1, 'b')
    g.p(11, 7 + b, 2, 1, 'e')
    g.p(13, 7 + b, 1, 1, 'n')
    g.p(2, 10, 9, 1, 'b')
    if breath:
        g.p(13, 1, 2, 1, 'w')
        g.p(14, 2, 1, 1, 'w')
        g.p(13, 3, 2, 1, 'w')
    return g.rows()


def cat_sit(blink):
    g = Grid(16, 12)
    g.p(5, 5, 6, 6, 'a')
    g.p(4, 7, 8, 4, 'a')
    g.p(6, 6, 1, 4, 'b')
    g.p(6, 1, 5, 5, 'a')
    g.p(6, 0, 1, 1, 'a')
    g.p(10, 0, 1, 1, 'a')
    g.p(7, 3, 1, 1, 'e' if not blink else 'b')
    g.p(9, 3, 1, 1, 'e' if not blink else 'b')
    g.p(8, 4, 1, 1, 'n')
    g.p(11, 9, 4, 2, 'a')
    g.p(14, 7, 1, 2, 'a')
    g.p(5, 11, 2, 1, 'b')
    g.p(9, 11, 2, 1, 'b')
    return g.rows()


# ── Dog (16×14): a = fur, b = shade, k = ear, c = collar, n = nose, e = eye ───────────
def dog_walk(step):
    g = Grid(16, 14)
    bob = step % 2
    g.p(1, 4 + bob, 2, 1, 'a')
    g.p(0, 3 + bob, 1, 2, 'a')
    g.p(2, 5 + bob, 10, 5, 'a')
    g.p(2, 9 + bob, 10, 1, 'b')
    g.p(10, 2 + bob, 5, 5, 'a')
    g.p(15, 4 + bob, 1, 2, 'a')
    g.p(10, 2 + bob, 2, 4, 'k')
    g.p(13, 3 + bob, 1, 1, 'e')
    g.p(15, 4 + bob, 1, 1, 'n')
    g.p(10, 7 + bob, 3, 1, 'c')
    legs = [(3, 10), (10, 10)] if step in (1, 3) else [(4, 10), (9, 10)]
    for lx, ly in legs:
        g.p(lx, ly + bob, 2, 4 - bob, 'b')
    g.p(6 if step == 1 else 7, 10 + bob, 2, 4 - bob, 'b')
    return g.rows()


def dog_lie(breath):
    g = Grid(16, 14)
    b = breath
    g.p(1, 9, 3, 1, 'a')
    g.p(2, 8 + b, 11, 5 - b, 'a')
    g.p(2, 12, 11, 1, 'b')
    g.p(11, 7, 5, 5, 'a')
    g.p(11, 7, 2, 4, 'k')
    g.p(14, 9, 1, 1, 'b')
    g.p(15, 10, 1, 1, 'n')
    g.p(11, 12, 5, 1, 'b')
    g.p(11, 11, 3, 1, 'c')
    return g.rows()


def dog_sit(tail):
    g = Grid(16, 14)
    g.p(4, 6, 7, 7, 'a')
    g.p(3, 9, 9, 4, 'a')
    g.p(5, 13, 2, 1, 'b')
    g.p(9, 13, 2, 1, 'b')
    g.p(5, 1, 6, 6, 'a')
    g.p(4, 1, 2, 4, 'k')
    g.p(10, 1, 2, 4, 'k')
    g.p(6, 3, 1, 1, 'e')
    g.p(9, 3, 1, 1, 'e')
    g.p(7, 5, 2, 1, 'n')
    g.p(5, 7, 6, 1, 'c')
    g.p(1 if tail else 12, 10, 3, 1, 'a')
    g.p(1 if tail else 14, 9, 1, 1, 'a')
    return g.rows()


# ── Parrot (12×12): a = body, w = wing, l = belly, y = beak, e = eye, f = feet ───────
def parrot_fly(up):
    g = Grid(12, 12)
    g.p(3, 5, 6, 3, 'a')
    g.p(8, 3, 3, 3, 'a')
    g.p(9, 4, 1, 1, 'e')
    g.p(11, 4, 1, 2, 'y')
    g.p(0, 6, 3, 1, 'w')
    g.p(4, 7, 4, 1, 'l')
    if up:
        g.p(3, 1, 4, 4, 'w')
        g.p(4, 0, 2, 1, 'w')
    else:
        g.p(3, 8, 4, 3, 'w')
        g.p(4, 11, 2, 1, 'w')
    return g.rows()


def parrot_sit(bob):
    g = Grid(12, 12)
    g.p(4, 3 + bob, 4, 4, 'a')
    g.p(5, 4 + bob, 1, 1, 'e')
    g.p(3, 5 + bob, 1, 2, 'y')
    g.p(4, 7, 5, 4, 'a')
    g.p(5, 8, 3, 3, 'l')
    g.p(8, 7, 2, 4, 'w')
    g.p(9, 10, 2, 2, 'w')
    g.p(5, 11, 1, 1, 'f')
    g.p(7, 11, 1, 1, 'f')
    return g.rows()


def pack(data, path):
    with open(path, 'w') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write('\n')


cat = {
    'format': 1, 'id': 'cat', 'name': 'Кот', 'author': 'Pixel Office contributors', 'license': 'MIT',
    'moves': 'walk', 'speed': 1.4, 'size': [16, 12],
    'rooms': ['lounge', 'reception', 'corridor', 'clevel', 'team', 'owner'],
    'coats': [
        {'id': 'ginger', 'name': 'Рыжий', 'colors': {'fur': '#e89a4a', 'furLo': '#c2742c', 'nose': '#f2a0a8'}},
        {'id': 'grey', 'name': 'Серый', 'colors': {'fur': '#9aa0ad', 'furLo': '#6f7583', 'nose': '#f2a0a8'}},
        {'id': 'black', 'name': 'Чёрный', 'colors': {'fur': '#2e2b36', 'furLo': '#1c1a22', 'nose': '#c97a82'}},
        {'id': 'calico', 'name': 'Трёхцветный', 'colors': {'fur': '#f1e6d2', 'furLo': '#d0873e', 'nose': '#f2a0a8'}}
    ],
    'instances': [{'id': 'ryzhik', 'name': 'Рыжик', 'coat': 'ginger'}, {'id': 'murka', 'name': 'Мурка', 'coat': 'grey'}],
    'sprites': {
        'legend': {'a': '$fur', 'b': '$furLo', 'n': '$nose', 'e': '@eye', 'w': '@white'},
        'walk': [cat_walk(i) for i in range(4)],
        'sleep': [cat_sleep(0), cat_sleep(1)],
        'sit': [cat_sit(0), cat_sit(0), cat_sit(1)]
    },
    'routines': [
        {'id': 'nap-sofa', 'at': 'sofa', 'pose': 'sleep', 'stay': [40, 120], 'weight': 3},
        {'id': 'nap-bed', 'at': 'bed', 'pose': 'sleep', 'stay': [40, 120], 'weight': 2},
        {'id': 'nap-desk', 'at': 'desk', 'pose': 'sleep', 'stay': [30, 90], 'weight': 2},
        {'id': 'sill', 'at': 'window', 'pose': 'sleep', 'stay': [30, 90], 'weight': 2},
        {'id': 'rub', 'at': 'bot', 'pose': 'sit', 'stay': [8, 20], 'weight': 2},
        {'id': 'fish', 'at': 'aquarium', 'pose': 'sit', 'stay': [15, 40], 'weight': 2},
        {'id': 'stroll', 'at': 'anywhere', 'pose': 'sit', 'stay': [4, 12], 'weight': 3}
    ]
}
dog = {
    'format': 1, 'id': 'dog', 'name': 'Собака', 'author': 'Pixel Office contributors', 'license': 'MIT',
    'moves': 'walk', 'speed': 2.2, 'size': [16, 14],
    'rooms': ['lounge', 'reception', 'corridor', 'clevel', 'team'],
    'coats': [
        {'id': 'brown', 'name': 'Коричневая', 'colors': {'fur': '#a8743f', 'furLo': '#7d5328', 'ear': '#5e3d1d', 'collar': '#d9534f'}},
        {'id': 'golden', 'name': 'Золотистая', 'colors': {'fur': '#e3b25f', 'furLo': '#b8873a', 'ear': '#c08a3a', 'collar': '#3e6fc4'}},
        {'id': 'spotty', 'name': 'Пятнистая', 'colors': {'fur': '#f1ede4', 'furLo': '#b9b3a6', 'ear': '#2e2b36', 'collar': '#3a9a5b'}}
    ],
    'instances': [{'id': 'bobik', 'name': 'Бобик', 'coat': 'brown'}],
    'sprites': {
        'legend': {'a': '$fur', 'b': '$furLo', 'k': '$ear', 'c': '$collar', 'n': '@ink', 'e': '@eye'},
        'walk': [dog_walk(i) for i in range(4)],
        'lie': [dog_lie(0), dog_lie(1)],
        'sit': [dog_sit(0), dog_sit(1)]
    },
    'routines': [
        {'id': 'follow', 'at': 'bot', 'pose': 'sit', 'stay': [20, 50], 'weight': 3, 'follow': True},
        {'id': 'door', 'at': 'owner-door', 'pose': 'lie', 'stay': [30, 90], 'weight': 2},
        {'id': 'bowl', 'at': 'bowl', 'pose': 'sit', 'stay': [10, 25], 'weight': 2},
        {'id': 'bed', 'at': 'bed', 'pose': 'lie', 'stay': [30, 90], 'weight': 1},
        {'id': 'stroll', 'at': 'anywhere', 'pose': 'sit', 'stay': [4, 10], 'weight': 2}
    ]
}
parrot = {
    'format': 1, 'id': 'parrot', 'name': 'Попугай', 'author': 'Pixel Office contributors', 'license': 'MIT',
    'moves': 'fly', 'speed': 3.5, 'size': [12, 12],
    'rooms': ['lounge', 'reception', 'corridor', 'clevel'],
    'coats': [
        {'id': 'green', 'name': 'Зелёный', 'colors': {'body': '#4cb84a', 'wing': '#2f7f8f', 'belly': '#e7d84a'}},
        {'id': 'blue', 'name': 'Сине-жёлтый', 'colors': {'body': '#3a7fd9', 'wing': '#24508f', 'belly': '#f2c94a'}},
        {'id': 'red', 'name': 'Ара', 'colors': {'body': '#d9443a', 'wing': '#3a6fd9', 'belly': '#f2b84a'}}
    ],
    'instances': [{'id': 'kesha', 'name': 'Кеша', 'coat': 'green'}],
    'sprites': {
        'legend': {'a': '$body', 'w': '$wing', 'l': '$belly', 'y': '@gold', 'e': '@eye', 'f': '@ink'},
        'fly': [parrot_fly(1), parrot_fly(0)],
        'sit': [parrot_sit(0), parrot_sit(0), parrot_sit(1)],
        'perch': [parrot_sit(0), parrot_sit(1)]
    },
    'routines': [
        {'id': 'cage', 'at': 'cage', 'pose': 'perch', 'stay': [40, 100], 'weight': 3},
        {'id': 'shelf', 'at': 'shelf', 'pose': 'perch', 'stay': [20, 60], 'weight': 3},
        {'id': 'shoulder', 'at': 'shoulder', 'pose': 'perch', 'stay': [10, 30], 'weight': 2},
        {'id': 'sill', 'at': 'window', 'pose': 'sit', 'stay': [15, 40], 'weight': 1}
    ]
}

if __name__ == '__main__':
    out = os.path.join(ROOT, 'plugin', 'office', 'animals')
    os.makedirs(out, exist_ok=True)
    for d in (cat, dog, parrot):
        pack(d, os.path.join(out, d['id'] + '.json'))
    pack(['cat.json', 'dog.json', 'parrot.json'], os.path.join(out, 'index.json'))
    print('wrote', out, file=sys.stderr)
