import pandas as pd
import json

# 엑셀 파일 경로 설정
xlsx_file_path = '파일 경로'
# EX) '/Users/@@@/Documents/realStationList 2.xlsx'

# 엑셀 파일 읽기
df = pd.read_excel(xlsx_file_path)

# 특정 열을 문자열로 변환
cols_to_convert = ['stop_no', 'ycode', 'xcode', 'node_id']

# 열 이름이 실제 데이터프레임에 존재하는지 확인 후 변환
existing_cols = [col for col in cols_to_convert if col in df.columns]
df[existing_cols] = df[existing_cols].astype(str)

df['stop_no'] = df['stop_no'].apply(lambda x: f"{int(x):05}" if x.isdigit() else x)

# JSON 데이터를 배열로 변환
json_array = df.to_dict(orient='records')

# 배열을 하나의 딕셔너리로 감싸주기
json_data = {'DATA': json_array}


total_data = {'DESCRIPTION' : {"STOP_TYPE":"정류소 타입","YCODE":"Y좌표","STOP_NM":"정류소명","NODE_ID":"노드 ID","STOP_NO":"정류소번호","XCODE":"X좌표", "NXT_STN": "다음 정류장 방면"}, 'DATA': json_array }

# JSON 데이터를 파일로 저장
json_file_path = '저장할 파일 경로 / total_stationList_final.json'
with open(json_file_path, 'w', encoding='utf-8') as file:
    json.dump(total_data, file, ensure_ascii=False, indent=2)

print(f'Successfully converted and saved to {json_file_path}')