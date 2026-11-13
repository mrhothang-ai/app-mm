const no = () => { throw new Error('Bản chạy trên Claude không đọc được thư mục trên máy. Hãy dùng nút chọn file.'); };
export const readFile = async () => no(), readdir = async () => no(), stat = async () => no();
