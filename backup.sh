# Parent backup directory
backup_parent_dir="./backup"

# Directories to backup
backup_me="./storage"

# Check and create backup directory
backup_date=`date +%Y_%m_%d_%H_%M`
backup_dir=${backup_parent_dir}/fs_${backup_date}
mkdir -p $backup_dir

# Perform backup
for directory in $backup_me
do
        archive_name=`echo ${directory} | sed s/^\\.?\\\/// | sed s/\\.?\\\//_/g`
        tar pcfzP ${backup_dir}/${archive_name}.tgz ${directory} 2>&1 | tee > ${backup_dir}/${archive_name}.log
done
