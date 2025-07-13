from langchain.document_loaders import PyPDFLoader
from langchain.text_splitter import RecursiveCharacterTextSplitter

# 1. טוען את קובץ ה־PDF
pdf_path = "data/STPA_Handbook.pdf"
loader = PyPDFLoader(pdf_path)
pages = loader.load()

# 2. חותך את הטקסט לקטעים קצרים (Chunks)
text_splitter = RecursiveCharacterTextSplitter(
    chunk_size=500,
    chunk_overlap=50
)

documents = text_splitter.split_documents(pages)

# הדפסה לבדיקה
print(f"Loaded {len(documents)} chunks from the STPA Handbook.")
print("--- דוגמה ראשונה ---")
print(documents[0].page_content)
